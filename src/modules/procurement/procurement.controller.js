/**
 * Procurement Controller — HTTP Handler Layer for Procurement & Goods Receipt
 * Source of truth: Blueprint §06.3, Phase 4A
 *
 * @module modules/procurement/procurement.controller
 */

export class ProcurementController {
  /**
   * @param {import('./procurement.service.js').ProcurementService} service
   */
  constructor(service) {
    this.service = service
  }

  createProcurement = async (req, reply) => {
    const vendorId = req.vendorId || req.user.vendorId || req.body.vendor_id
    const actorId = req.userId || req.user.id
    const result = await this.service.createProcurement(vendorId, actorId, req.body)
    return reply.status(201).send({ success: true, data: result })
  }

  submitProcurement = async (req, reply) => {
    const { orderId } = req.params
    const vendorId = req.vendorId || req.user.vendorId
    const actorId = req.userId || req.user.id
    const updated = await this.service.submitProcurement(orderId, vendorId, actorId)
    return reply.status(200).send({ success: true, data: updated })
  }

  approveProcurement = async (req, reply) => {
    const { orderId } = req.params
    const actorId = req.userId || req.user.id
    const updated = await this.service.approveProcurement(orderId, actorId)
    return reply.status(200).send({ success: true, data: updated })
  }

  cancelProcurement = async (req, reply) => {
    const { orderId } = req.params
    const vendorId = req.vendorId || req.user.vendorId
    const actorId = req.userId || req.user.id
    const updated = await this.service.cancelProcurement(orderId, vendorId, actorId, req.body?.reason)
    return reply.status(200).send({ success: true, data: updated })
  }

  recordGoodsReceipt = async (req, reply) => {
    const { orderId } = req.params
    const vendorId = req.vendorId || req.user.vendorId
    const actorId = req.userId || req.user.id
    const result = await this.service.recordGoodsReceipt(orderId, vendorId, actorId, req.body)
    return reply.status(200).send({ success: true, data: result })
  }

  addMedia = async (req, reply) => {
    const { orderId } = req.params
    const vendorId = req.vendorId || req.user.vendorId
    const actorId = req.userId || req.user.id
    const media = await this.service.addMedia(orderId, vendorId, actorId, req.body)
    return reply.status(201).send({ success: true, data: media })
  }

  getOrderById = async (req, reply) => {
    const { orderId } = req.params
    const order = await this.service.getOrderById(orderId)
    return reply.status(200).send({ success: true, data: order })
  }

  listOrders = async (req, reply) => {
    const queryParams = {
      ...req.query,
      vendorId: req.vendorId || req.query.vendor_id || null,
    }
    const result = await this.service.listOrders(queryParams)
    return reply.status(200).send({ success: true, ...result })
  }
}
