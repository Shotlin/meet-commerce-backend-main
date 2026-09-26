/**
 * Inventory Service — FEFO Allocation Engine & Stock Ledger Business Logic
 * Source of truth: Blueprint §06.5, Phase 6
 *
 * @module modules/inventory/inventory.service
 */

import { logger } from '../../config/logger.js'

export class InventoryService {
  /**
   * @param {import('./inventory.repository.js').InventoryRepository} repository
   */
  constructor(repository) {
    this.repository = repository
  }

  /**
   * Register inbound stock for a lot
   * @param {string} actorId
   * @param {object} payload
   * @returns {Promise<object>}
   */
  async registerInbound(actorId, payload) {
    const { warehouse_id, product_id, batch_id = null, batch_number, expiry_date, quantity } = payload

    if (new Date(expiry_date) <= new Date()) {
      const err = new Error('Cannot register inbound stock for expired lot')
      err.statusCode = 400
      err.code = 'EXPIRED_LOT_REJECTED'
      throw err
    }

    const lot = await this.repository.createLot({
      warehouse_id,
      product_id,
      batch_id,
      batch_number,
      expiry_date,
      quantity,
    })

    const ledger = await this.repository.writeLedgerEntry({
      lot_id: lot.id,
      warehouse_id,
      product_id,
      movement_type: 'INBOUND',
      quantity_change: Number(quantity),
      balance_after: Number(lot.quantity_on_hand),
      reference_type: 'INBOUND_RECEIPT',
      actor_id: actorId,
    })

    logger.info({ lotId: lot.id, warehouse_id, product_id, quantity }, 'Inbound stock registered')
    return { lot, ledger }
  }

  /**
   * Reserve stock using FEFO (First Expiry First Out) algorithm
   * @param {string} actorId
   * @param {object} payload
   * @returns {Promise<object>}
   */
  async reserveFefo(actorId, payload) {
    const { warehouse_id, product_id, quantity, reservation_key, ttl_seconds = 900 } = payload

    // Check if reservation key already exists
    const existing = await this.repository.findReservationsByKey(reservation_key)
    if (existing.length > 0) {
      const err = new Error(`Reservation key ${reservation_key} is already active`)
      err.statusCode = 409
      err.code = 'DUPLICATE_RESERVATION_KEY'
      throw err
    }

    const availableLots = await this.repository.findAvailableLotsFefo(warehouse_id, product_id)

    // Calculate total available stock across FEFO lots
    let totalAvailable = 0
    for (const lot of availableLots) {
      totalAvailable += Number(lot.quantity_available)
    }

    if (totalAvailable < Number(quantity)) {
      const err = new Error(`Insufficient stock available. Required: ${quantity}, Available: ${totalAvailable}`)
      err.statusCode = 400
      err.code = 'INSUFFICIENT_STOCK'
      throw err
    }

    // Allocate across FEFO lots
    let remainingToReserve = Number(quantity)
    const reservations = []
    const expiresAt = new Date(Date.now() + ttl_seconds * 1000)

    for (const lot of availableLots) {
      if (remainingToReserve <= 0) break

      const lotAvailable = Number(lot.quantity_available)
      const reserveFromLot = Math.min(lotAvailable, remainingToReserve)

      // Update lot reserved quantity
      const updatedLot = await this.repository.updateLotQuantities(lot.id, 0, reserveFromLot)

      // Create reservation record
      const reservation = await this.repository.createReservation({
        reservation_key,
        warehouse_id,
        product_id,
        lot_id: lot.id,
        quantity_reserved: reserveFromLot,
        expires_at: expiresAt,
      })
      reservations.push(reservation)

      // Write ledger entry
      await this.repository.writeLedgerEntry({
        lot_id: lot.id,
        warehouse_id,
        product_id,
        movement_type: 'RESERVATION',
        quantity_change: -reserveFromLot,
        balance_after: Number(updatedLot.quantity_available),
        reference_type: 'STOCK_RESERVATION',
        reference_id: reservation.id,
        actor_id: actorId,
      })

      remainingToReserve -= reserveFromLot
    }

    logger.info({ reservation_key, warehouse_id, product_id, quantity, lotCount: reservations.length }, 'FEFO reservation created')
    return { reservation_key, total_reserved: Number(quantity), reservations }
  }

  /**
   * Release reserved stock
   * @param {string} actorId
   * @param {string} reservationKey
   * @returns {Promise<object>}
   */
  async releaseReservation(actorId, reservationKey) {
    const reservations = await this.repository.findReservationsByKey(reservationKey)
    if (reservations.length === 0) {
      const err = new Error(`Active reservation with key ${reservationKey} not found`)
      err.statusCode = 404
      err.code = 'RESERVATION_NOT_FOUND'
      throw err
    }

    const released = []
    for (const res of reservations) {
      await this.repository.updateReservationStatus(res.id, 'RELEASED')
      const updatedLot = await this.repository.updateLotQuantities(res.lot_id, 0, -Number(res.quantity_reserved))

      await this.repository.writeLedgerEntry({
        lot_id: res.lot_id,
        warehouse_id: res.warehouse_id,
        product_id: res.product_id,
        movement_type: 'RELEASE',
        quantity_change: Number(res.quantity_reserved),
        balance_after: Number(updatedLot.quantity_available),
        reference_type: 'STOCK_RELEASE',
        reference_id: res.id,
        actor_id: actorId,
      })

      released.push(res)
    }

    logger.info({ reservationKey, releasedCount: released.length }, 'Stock reservation released')
    return { success: true, reservationKey, releasedCount: released.length }
  }

  /**
   * Adjust stock for a lot (shrinkage, damaged, correction)
   * @param {string} actorId
   * @param {object} payload
   * @returns {Promise<object>}
   */
  async adjustStock(actorId, payload) {
    const { lot_id, quantity_change, reason } = payload
    const lot = await this.repository.findLotById(lot_id)

    if (!lot) {
      const err = new Error('Inventory lot not found')
      err.statusCode = 404
      err.code = 'LOT_NOT_FOUND'
      throw err
    }

    const newOnHand = Number(lot.quantity_on_hand) + Number(quantity_change)
    if (newOnHand < 0 || (newOnHand - Number(lot.quantity_reserved)) < 0) {
      const err = new Error('Stock adjustment cannot result in negative available inventory')
      err.statusCode = 400
      err.code = 'NEGATIVE_STOCK_PREVENTED'
      throw err
    }

    const updatedLot = await this.repository.updateLotQuantities(lot_id, Number(quantity_change), 0)
    const adjustment = await this.repository.createAdjustment(lot_id, Number(quantity_change), reason, actorId)

    const ledger = await this.repository.writeLedgerEntry({
      lot_id: lot_id,
      warehouse_id: lot.warehouse_id,
      product_id: lot.product_id,
      movement_type: 'ADJUSTMENT',
      quantity_change: Number(quantity_change),
      balance_after: Number(updatedLot.quantity_on_hand),
      reference_type: 'STOCK_ADJUSTMENT',
      reference_id: adjustment.id,
      actor_id: actorId,
    })

    logger.info({ lot_id, quantity_change, reason }, 'Stock adjustment processed')
    return { lot: updatedLot, adjustment, ledger }
  }

  async listLots(warehouseId, productId = null) {
    return this.repository.listLots(warehouseId, productId)
  }

  async getQualityTraceForOrderItems(orderItemIds) {
    return this.repository.findQualityTraceForOrderItems(orderItemIds)
  }

  /**
   * Fulfil one sold order line from FEFO-ordered inventory lots and record
   * which lot(s) it actually came from — the link a customer's invoice QR
   * later resolves back to a vendor's quality-video evidence.
   *
   * Deliberately best-effort: called from inside the same DB transaction
   * as `placeOrder`'s own stock decrement, but a shortfall (no lots at
   * all, or fewer lots than the quantity sold — e.g. the product was
   * stocked manually and never received through vendor procurement) is
   * not an error. `shop_products.stock_quantity` remains the one
   * authoritative sellable-stock check; this is purely an additive
   * traceability side-channel that must never block or fail a real order.
   * Spills across lot boundaries automatically (drains the oldest/nearest-
   * expiry lot first, then continues into the next one for the remainder)
   * so old and newly-arrived stock of the same product are both correctly
   * attributed without the caller needing to know lot boundaries exist.
   */
  async consumeForOrderItem(actorId, { warehouseId, productId, orderItemId, quantity }, client = null) {
    if (!warehouseId || !productId || !orderItemId || !(Number(quantity) > 0)) {
      return { allocations: [] }
    }

    const lots = await this.repository.findAvailableLotsFefo(warehouseId, productId, client)
    let remaining = Number(quantity)
    const allocations = []

    for (const lot of lots) {
      if (remaining <= 0) break
      const available = Number(lot.quantity_on_hand) - Number(lot.quantity_reserved)
      if (available <= 0) continue
      const take = Math.min(available, remaining)

      const updatedLot = await this.repository.consumeLotOnHand(lot.id, take, client)
      if (!updatedLot) continue // lost a race to another consumer — try the next lot

      await this.repository.writeLedgerEntry({
        lot_id: lot.id,
        warehouse_id: warehouseId,
        product_id: productId,
        movement_type: 'OUTBOUND',
        quantity_change: -take,
        balance_after: Number(updatedLot.quantity_on_hand),
        reference_type: 'ORDER_ITEM',
        reference_id: orderItemId,
        actor_id: actorId,
      }, client)

      const allocation = await this.repository.insertOrderItemAllocation(client, {
        orderItemId,
        inventoryLotId: lot.id,
        quantityAllocated: take,
      })
      allocations.push(allocation)

      remaining -= take
    }

    if (remaining > 0 && allocations.length > 0) {
      logger.warn(
        { orderItemId, productId, warehouseId, shortfall: remaining },
        'Order item allocated from fewer lots than quantity sold — some of this sale is untraceable to a vendor batch'
      )
    }

    return { allocations }
  }

  async getLedgerEntries(warehouseId, productId = null) {
    return this.repository.getLedgerEntries(warehouseId, productId)
  }
}
