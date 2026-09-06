/**
 * Warehouse Receipts Controller — HTTP Handler Layer for Receipts & QC Inspections
 * Source of truth: Blueprint §06.4, Phase 5A
 *
 * @module modules/warehouse-receipts/warehouse-receipts.controller
 */

export class WarehouseReceiptsController {
  /**
   * @param {import('./warehouse-receipts.service.js').WarehouseReceiptsService} service
   */
  constructor(service) {
    this.service = service
  }

  createReceipt = async (req, reply) => {
    const actorId = req.userId || req.user.id
    const result = await this.service.createReceipt(actorId, req.body)
    return reply.status(201).send({ success: true, data: result })
  }

  startReceiving = async (req, reply) => {
    const { receiptId } = req.params
    const warehouseId = req.warehouseId || req.user.warehouseId
    const actorId = req.userId || req.user.id
    const updated = await this.service.startReceiving(receiptId, warehouseId, actorId)
    return reply.status(200).send({ success: true, data: updated })
  }

  submitForQc = async (req, reply) => {
    const { receiptId } = req.params
    const warehouseId = req.warehouseId || req.user.warehouseId
    const actorId = req.userId || req.user.id
    const updated = await this.service.submitForQc(receiptId, warehouseId, actorId)
    return reply.status(200).send({ success: true, data: updated })
  }

  performQcInspection = async (req, reply) => {
    const { receiptId } = req.params
    const inspectorId = req.userId || req.user.id
    const result = await this.service.performQcInspection(receiptId, inspectorId, req.body)
    return reply.status(200).send({ success: true, data: result })
  }

  getReceiptById = async (req, reply) => {
    const { receiptId } = req.params
    const receipt = await this.service.getReceiptById(receiptId)
    return reply.status(200).send({ success: true, data: receipt })
  }

  listReceipts = async (req, reply) => {
    const queryParams = {
      ...req.query,
      warehouseId: req.warehouseId || req.query.warehouse_id || null,
    }
    const result = await this.service.listReceipts(queryParams)
    return reply.status(200).send({ success: true, ...result })
  }
}
