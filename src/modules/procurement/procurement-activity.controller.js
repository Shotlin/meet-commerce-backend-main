/**
 * Procurement Activity Controller — HTTP Handler Layer for Comments & Activity Timelines
 * Source of truth: Blueprint §06.3, Phase 4B
 *
 * @module modules/procurement/procurement-activity.controller
 */

export class ProcurementActivityController {
  /**
   * @param {import('./procurement-activity.service.js').ProcurementActivityService} service
   */
  constructor(service) {
    this.service = service
  }

  addComment = async (req, reply) => {
    const { orderId } = req.params
    const vendorId = req.vendorId || req.user.vendorId
    const userId = req.userId || req.user.id
    const comment = await this.service.addComment(orderId, vendorId, userId, req.body.comment)
    return reply.status(201).send({ success: true, data: comment })
  }

  getComments = async (req, reply) => {
    const { orderId } = req.params
    const comments = await this.service.getComments(orderId)
    return reply.status(200).send({ success: true, data: comments })
  }

  addCategorizedMedia = async (req, reply) => {
    const { orderId } = req.params
    const vendorId = req.vendorId || req.user.vendorId
    const userId = req.userId || req.user.id
    const media = await this.service.addCategorizedMedia(orderId, vendorId, userId, req.body)
    return reply.status(201).send({ success: true, data: media })
  }

  getCategorizedMedia = async (req, reply) => {
    const { orderId } = req.params
    const media = await this.service.getCategorizedMedia(orderId)
    return reply.status(200).send({ success: true, data: media })
  }

  getAuditTimeline = async (req, reply) => {
    const { orderId } = req.params
    const timeline = await this.service.getAuditTimeline(orderId)
    return reply.status(200).send({ success: true, data: timeline })
  }
}
