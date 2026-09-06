/**
 * Procurement Activity Service — Business Logic for Comments, Categorized Evidence & Timelines
 * Source of truth: Blueprint §06.3, Phase 4B
 *
 * @module modules/procurement/procurement-activity.service
 */

import { logger } from '../../config/logger.js'

export class ProcurementActivityService {
  /**
   * @param {import('./procurement-activity.repository.js').ProcurementActivityRepository} repository
   * @param {import('./procurement.repository.js').ProcurementRepository} procurementRepository
   */
  constructor(repository, procurementRepository) {
    this.repository = repository
    this.procurementRepository = procurementRepository
  }

  async validateProcurementState(orderId, vendorId) {
    const order = await this.procurementRepository.findOrderById(orderId)
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

    if (order.status === 'CLOSED') {
      const err = new Error('Procurement comments and evidence cannot be modified after order is CLOSED')
      err.statusCode = 400
      err.code = 'ORDER_CLOSED_LOCKED'
      throw err
    }

    return order
  }

  // ─── COMMENTS ───────────────────────────────────────
  async addComment(orderId, vendorId, userId, commentText) {
    await this.validateProcurementState(orderId, vendorId)
    const comment = await this.repository.addComment(orderId, userId, commentText)
    logger.info({ orderId, commentId: comment.id, userId }, 'Procurement comment added')
    return comment
  }

  async getComments(orderId) {
    return this.repository.getComments(orderId)
  }

  // ─── MEDIA EVIDENCE ──────────────────────────────────
  async addCategorizedMedia(orderId, vendorId, userId, mediaData) {
    await this.validateProcurementState(orderId, vendorId)
    const media = await this.repository.addCategorizedMedia(orderId, mediaData, userId)
    logger.info({ orderId, mediaId: media.id, category: media.category }, 'Procurement evidence added')
    return media
  }

  async getCategorizedMedia(orderId) {
    return this.repository.getCategorizedMedia(orderId)
  }

  // ─── AUDIT TIMELINE ─────────────────────────────────
  async getAuditTimeline(orderId) {
    return this.repository.getCombinedTimeline(orderId)
  }
}
