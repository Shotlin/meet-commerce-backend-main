/**
 * QC Evidence Repository — Data Access Layer for QC Evidence, Defects & Dispositions
 * Source of truth: Blueprint §06.4, Phase 5B
 *
 * @module modules/warehouse-receipts/qc-evidence.repository
 */

import { query } from '../../config/database.js'

export class QcEvidenceRepository {
  // ─── INSPECTIONS ────────────────────────────────────
  async findInspectionById(inspectionId) {
    const { rows } = await query(
      `SELECT qi.*, wr.warehouse_id, wr.status AS receipt_status
         FROM quality_inspections qi
         JOIN warehouse_receipts wr ON wr.id = qi.warehouse_receipt_id
        WHERE qi.id = $1 LIMIT 1`,
      [inspectionId]
    )
    return rows[0] || null
  }

  // ─── MEDIA EVIDENCE ──────────────────────────────────
  async addMedia(inspectionId, mediaData, userId = null) {
    const { media_type, file_key, file_url = null, mime_type = null, size = null, category = 'GENERAL' } = mediaData
    const { rows } = await query(
      `INSERT INTO quality_inspection_media (quality_inspection_id, media_type, file_key, file_url, mime_type, size, uploaded_by, category)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [inspectionId, media_type, file_key, file_url, mime_type, size, userId, category]
    )
    return rows[0]
  }

  async getMedia(inspectionId) {
    const { rows } = await query(
      `SELECT * FROM quality_inspection_media WHERE quality_inspection_id = $1 ORDER BY created_at ASC`,
      [inspectionId]
    )
    return rows
  }

  // ─── DEFECTS & CORRECTIVE ACTIONS ─────────────────────
  async addDefect(inspectionId, defectData) {
    const { title, category, severity, description = null } = defectData
    const { rows } = await query(
      `INSERT INTO quality_defects (quality_inspection_id, title, category, severity, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [inspectionId, title, category, severity, description]
    )
    return rows[0]
  }

  async addCorrectiveAction(defectId, actionPlan, assignedTo = null) {
    const { rows } = await query(
      `INSERT INTO quality_corrective_actions (defect_id, action_plan, assigned_to)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [defectId, actionPlan, assignedTo]
    )
    return rows[0]
  }

  async getDefects(inspectionId) {
    const { rows } = await query(
      `SELECT d.*, row_to_json(ca.*) AS corrective_action
         FROM quality_defects d
         LEFT JOIN quality_corrective_actions ca ON ca.defect_id = d.id
        WHERE d.quality_inspection_id = $1
        ORDER BY d.created_at ASC`,
      [inspectionId]
    )
    return rows
  }

  // ─── DISPOSITIONS ────────────────────────────────────
  async createDisposition(inspectionId, status, reviewerId = null, remarks = null) {
    const { rows } = await query(
      `INSERT INTO quality_dispositions (quality_inspection_id, status, reviewer_id, remarks)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [inspectionId, status, reviewerId, remarks]
    )
    return rows[0]
  }

  async getDispositions(inspectionId) {
    const { rows } = await query(
      `SELECT * FROM quality_dispositions WHERE quality_inspection_id = $1 ORDER BY created_at DESC`,
      [inspectionId]
    )
    return rows
  }
}
