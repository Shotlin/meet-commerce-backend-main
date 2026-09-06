/**
 * Procurement Service — Business Logic & Goods Receipt Engine
 * Source of truth: Blueprint §06.3, Phase 4A
 *
 * @module modules/procurement/procurement.service
 */

import crypto from 'node:crypto'
import { logger } from '../../config/logger.js'

const PROCUREMENT_TRANSITIONS = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['APPROVED', 'CANCELLED'],
  APPROVED: ['PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
  PARTIALLY_RECEIVED: ['RECEIVED', 'CANCELLED'],
  RECEIVED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
}

export class ProcurementService {
  /**
   * @param {import('./procurement.repository.js').ProcurementRepository} repository
   */
  constructor(repository) {
    this.repository = repository
  }

  validateStateTransition(currentStatus, nextStatus) {
    const allowed = PROCUREMENT_TRANSITIONS[currentStatus] || []
    if (!allowed.includes(nextStatus)) {
      const err = new Error(`Invalid state transition from ${currentStatus} to ${nextStatus}`)
      err.statusCode = 400
      err.code = 'INVALID_STATE_TRANSITION'
      throw err
    }
  }

  async createProcurement(vendorId, actorId, payload) {
    const orderNumber = `PO-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`

    let totalCost = 0
    for (const item of payload.items) {
      totalCost += Number(item.quantity_ordered) * Number(item.unit_cost)
    }

    const order = await this.repository.createProcurementOrder(vendorId, orderNumber, payload.notes, totalCost)

    const items = []
    for (const itemData of payload.items) {
      const item = await this.repository.addProcurementItem(order.id, itemData)
      items.push(item)
    }

    await this.repository.logAudit({
      orderId: order.id,
      actorId,
      action: 'CREATE',
      newStatus: 'DRAFT',
      comments: 'Procurement order created',
    })

    logger.info({ orderId: order.id, orderNumber, vendorId }, 'Procurement order created')
    return { ...order, items }
  }

  async submitProcurement(orderId, vendorId, actorId) {
    const order = await this.repository.findOrderById(orderId)
    if (!order) {
      const err = new Error('Procurement order not found')
      err.statusCode = 404
      err.code = 'PROCUREMENT_NOT_FOUND'
      throw err
    }

    if (order.vendor_id !== vendorId) {
      const err = new Error('Forbidden — order does not belong to your vendor')
      err.statusCode = 403
      err.code = 'CROSS_SHOP_ACCESS_DENIED'
      throw err
    }

    this.validateStateTransition(order.status, 'SUBMITTED')
    const updated = await this.repository.updateOrderStatus(orderId, 'SUBMITTED')

    await this.repository.logAudit({
      orderId,
      actorId,
      action: 'SUBMIT',
      previousStatus: order.status,
      newStatus: 'SUBMITTED',
    })

    logger.info({ orderId }, 'Procurement order submitted')
    return updated
  }

  async approveProcurement(orderId, actorId) {
    const order = await this.repository.findOrderById(orderId)
    if (!order) {
      const err = new Error('Procurement order not found')
      err.statusCode = 404
      err.code = 'PROCUREMENT_NOT_FOUND'
      throw err
    }

    this.validateStateTransition(order.status, 'APPROVED')
    const updated = await this.repository.updateOrderStatus(orderId, 'APPROVED')

    await this.repository.logAudit({
      orderId,
      actorId,
      action: 'APPROVE',
      previousStatus: order.status,
      newStatus: 'APPROVED',
    })

    logger.info({ orderId }, 'Procurement order approved')
    return updated
  }

  async cancelProcurement(orderId, vendorId, actorId, reason = null) {
    const order = await this.repository.findOrderById(orderId)
    if (!order) {
      const err = new Error('Procurement order not found')
      err.statusCode = 404
      err.code = 'PROCUREMENT_NOT_FOUND'
      throw err
    }

    if (order.vendor_id !== vendorId) {
      const err = new Error('Forbidden — order does not belong to your vendor')
      err.statusCode = 403
      err.code = 'CROSS_SHOP_ACCESS_DENIED'
      throw err
    }

    this.validateStateTransition(order.status, 'CANCELLED')
    const updated = await this.repository.updateOrderStatus(orderId, 'CANCELLED')

    await this.repository.logAudit({
      orderId,
      actorId,
      action: 'CANCEL',
      previousStatus: order.status,
      newStatus: 'CANCELLED',
      comments: reason,
    })

    logger.info({ orderId }, 'Procurement order cancelled')
    return updated
  }

  async recordGoodsReceipt(orderId, vendorId, actorId, payload) {
    const order = await this.repository.findOrderById(orderId)
    if (!order) {
      const err = new Error('Procurement order not found')
      err.statusCode = 404
      err.code = 'PROCUREMENT_NOT_FOUND'
      throw err
    }

    if (order.vendor_id !== vendorId) {
      const err = new Error('Forbidden — order does not belong to your vendor')
      err.statusCode = 403
      err.code = 'CROSS_SHOP_ACCESS_DENIED'
      throw err
    }

    if (order.status !== 'APPROVED' && order.status !== 'PARTIALLY_RECEIVED') {
      const err = new Error(`Cannot record goods receipt when order status is ${order.status}`)
      err.statusCode = 400
      err.code = 'INVALID_PROCUREMENT_STATUS'
      throw err
    }

    const createdBatches = []
    for (const receipt of payload.receipts) {
      const item = await this.repository.findItemById(receipt.item_id)
      if (!item) {
        const err = new Error(`Procurement item ${receipt.item_id} not found`)
        err.statusCode = 404
        err.code = 'ITEM_NOT_FOUND'
        throw err
      }

      // Check quantity received limits
      const totalAfterReceipt = Number(item.quantity_received) + Number(receipt.quantity_received)
      if (totalAfterReceipt > Number(item.quantity_ordered)) {
        const err = new Error(`Quantity received (${totalAfterReceipt}) exceeds ordered quantity (${item.quantity_ordered})`)
        err.statusCode = 400
        err.code = 'EXCEEDS_ORDERED_QUANTITY'
        throw err
      }

      // Check batch uniqueness
      const duplicateBatch = await this.repository.findDuplicateBatchNumber(receipt.batch_number)
      if (duplicateBatch) {
        const err = new Error(`Batch number ${receipt.batch_number} already exists`)
        err.statusCode = 409
        err.code = 'DUPLICATE_BATCH_NUMBER'
        throw err
      }

      // Create batch & update item quantity
      const batch = await this.repository.createBatch({
        procurement_order_id: orderId,
        procurement_item_id: receipt.item_id,
        batch_number: receipt.batch_number,
        quantity: receipt.quantity_received,
        manufactured_date: receipt.manufactured_date || null,
        expiry_date: receipt.expiry_date || null,
      })
      createdBatches.push(batch)

      await this.repository.updateItemQuantityReceived(receipt.item_id, receipt.quantity_received)
    }

    // Refresh order to evaluate partial vs full completion
    const refreshedOrder = await this.repository.findOrderById(orderId)
    let allReceived = true
    for (const item of refreshedOrder.items) {
      if (Number(item.quantity_received) < Number(item.quantity_ordered)) {
        allReceived = false
        break
      }
    }

    const targetStatus = allReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED'
    const updatedOrder = await this.repository.updateOrderStatus(orderId, targetStatus)

    await this.repository.logAudit({
      orderId,
      actorId,
      action: 'GOODS_RECEIPT',
      previousStatus: order.status,
      newStatus: targetStatus,
      comments: `Received ${createdBatches.length} batch(es)`,
    })

    logger.info({ orderId, targetStatus, batchCount: createdBatches.length }, 'Goods receipt recorded')
    return { order: updatedOrder, batches: createdBatches }
  }

  async addMedia(orderId, vendorId, actorId, mediaData) {
    const order = await this.repository.findOrderById(orderId)
    if (!order) {
      const err = new Error('Procurement order not found')
      err.statusCode = 404
      err.code = 'PROCUREMENT_NOT_FOUND'
      throw err
    }

    if (order.status === 'CLOSED') {
      const err = new Error('Procurement evidence cannot be added or modified after order is CLOSED')
      err.statusCode = 400
      err.code = 'ORDER_CLOSED_LOCKED'
      throw err
    }

    const media = await this.repository.addMedia(orderId, mediaData, actorId)
    logger.info({ orderId, mediaId: media.id }, 'Procurement evidence added')
    return media
  }

  async getOrderById(orderId) {
    const order = await this.repository.findOrderById(orderId)
    if (!order) {
      const err = new Error('Procurement order not found')
      err.statusCode = 404
      err.code = 'PROCUREMENT_NOT_FOUND'
      throw err
    }
    return order
  }

  async listOrders(params) {
    return this.repository.listOrders(params)
  }
}
