/**
 * QC Evidence Service — Business Logic for QC Evidence, Defects & Dispositions
 * Source of truth: Blueprint §06.4, Phase 5B
 *
 * @module modules/warehouse-receipts/qc-evidence.service
 */

import { logger } from '../../config/logger.js'

export class QcEvidenceService {
  /**
   * @param {import('./qc-evidence.repository.js').QcEvidenceRepository} repository
   */
  constructor(repository) {
    this.repository = repository
  }

  async validateInspectionState(inspectionId, warehouseId) {
    const inspection = await this.repository.findInspectionById(inspectionId)
    if (!inspection) {
      const err = new Error('Quality inspection not found')
      err.statusCode = 404
      err.code = 'INSPECTION_NOT_FOUND'
      throw err
    }

    if (inspection.warehouse_id !== warehouseId) {
      const err = new Error('Forbidden — inspection does not belong to your warehouse')
      err.statusCode = 403
      err.code = 'CROSS_WAREHOUSE_ACCESS_DENIED'
      throw err
    }

    if (inspection.receipt_status === 'RECEIVED' || inspection.receipt_status === 'RETURNED') {
      const err = new Error('Cannot modify evidence, defects, or dispositions after receipt is CLOSED')
      err.statusCode = 400
      err.code = 'RECEIPT_CLOSED_LOCKED'
      throw err
    }

    return inspection
  }

  // ─── MEDIA EVIDENCE ──────────────────────────────────
  async addMedia(inspectionId, warehouseId, userId, mediaData) {
    await this.validateInspectionState(inspectionId, warehouseId)
    const media = await this.repository.addMedia(inspectionId, mediaData, userId)
    logger.info({ inspectionId, mediaId: media.id, category: media.category }, 'QC evidence added')
    return media
  }

  async getMedia(inspectionId) {
    return this.repository.getMedia(inspectionId)
  }

  // ─── DEFECT MANAGEMENT ───────────────────────────────
  async addDefect(inspectionId, warehouseId, defectData) {
    await this.validateInspectionState(inspectionId, warehouseId)

    const { severity, action_plan } = defectData
    if (severity === 'CRITICAL' && (!action_plan || !action_plan.trim())) {
      const err = new Error('Critical defects require a corrective action plan')
      err.statusCode = 400
      err.code = 'CORRECTIVE_ACTION_REQUIRED'
      throw err
    }

    const defect = await this.repository.addDefect(inspectionId, defectData)

    let correctiveAction = null
    if (action_plan && action_plan.trim()) {
      correctiveAction = await this.repository.addCorrectiveAction(defect.id, action_plan.trim())
    }

    logger.info({ inspectionId, defectId: defect.id, severity: defect.severity }, 'QC defect recorded')
    return { ...defect, corrective_action: correctiveAction }
  }

  async getDefects(inspectionId) {
    return this.repository.getDefects(inspectionId)
  }

  // ─── DISPOSITION WORKFLOW ────────────────────────────
  async submitDisposition(inspectionId, warehouseId, reviewerId, dispositionData) {
    await this.validateInspectionState(inspectionId, warehouseId)

    const { status, remarks } = dispositionData
    const disposition = await this.repository.createDisposition(inspectionId, status, reviewerId, remarks || null)

    logger.info({ inspectionId, reviewerId, dispositionStatus: status }, 'QC disposition submitted')
    return disposition
  }

  async getDispositions(inspectionId) {
    return this.repository.getDispositions(inspectionId)
  }
}
