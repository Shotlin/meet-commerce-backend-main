/**
 * Inventory Controller — HTTP Handler Layer for Inventory Lots, Ledger & FEFO Reservations
 * Source of truth: Blueprint §06.5, Phase 6
 *
 * @module modules/inventory/inventory.controller
 */

export class InventoryController {
  /**
   * @param {import('./inventory.service.js').InventoryService} service
   */
  constructor(service) {
    this.service = service
  }

  registerInbound = async (req, reply) => {
    const actorId = req.userId || req.user.id
    const result = await this.service.registerInbound(actorId, req.body)
    return reply.status(201).send({ success: true, data: result })
  }

  reserveFefo = async (req, reply) => {
    const actorId = req.userId || req.user.id
    const result = await this.service.reserveFefo(actorId, req.body)
    return reply.status(201).send({ success: true, data: result })
  }

  releaseReservation = async (req, reply) => {
    const actorId = req.userId || req.user.id
    const { reservation_key } = req.body
    const result = await this.service.releaseReservation(actorId, reservation_key)
    return reply.status(200).send({ success: true, data: result })
  }

  adjustStock = async (req, reply) => {
    const actorId = req.userId || req.user.id
    const result = await this.service.adjustStock(actorId, req.body)
    return reply.status(200).send({ success: true, data: result })
  }

  listLots = async (req, reply) => {
    const warehouseId = req.warehouseId || req.query.warehouse_id
    const productId = req.query.product_id || null
    const lots = await this.service.listLots(warehouseId, productId)
    return reply.status(200).send({ success: true, data: lots })
  }

  getLedgerEntries = async (req, reply) => {
    const warehouseId = req.warehouseId || req.query.warehouse_id
    const productId = req.query.product_id || null
    const ledger = await this.service.getLedgerEntries(warehouseId, productId)
    return reply.status(200).send({ success: true, data: ledger })
  }
}
