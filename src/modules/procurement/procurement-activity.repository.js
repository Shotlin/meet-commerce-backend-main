/**
 * Procurement Activity Repository — Data Access Layer for Comments & Audit Timelines
 * Source of truth: Blueprint §06.3, Phase 4B
 *
 * @module modules/procurement/procurement-activity.repository
 */

import { query } from '../../config/database.js'

export class ProcurementActivityRepository {
  // ─── COMMENTS ───────────────────────────────────────
  async addComment(orderId, userId, commentText) {
    const { rows } = await query(
      `INSERT INTO procurement_comments (procurement_order_id, user_id, comment)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [orderId, userId, commentText]
    )
    return rows[0]
  }

  async getComments(orderId) {
    const { rows } = await query(
      `SELECT c.*, u.email AS user_email, u.name AS user_name
         FROM procurement_comments c
         LEFT JOIN users u ON u.id = c.user_id
        WHERE c.procurement_order_id = $1
        ORDER BY c.created_at ASC`,
      [orderId]
    )
    return rows
  }

  // ─── MEDIA EVIDENCE ──────────────────────────────────
  async addCategorizedMedia(orderId, mediaData, userId = null) {
    const { media_type, file_key, file_url = null, mime_type = null, size = null, category = 'GENERAL', sort_order = 0 } = mediaData
    const { rows } = await query(
      `INSERT INTO procurement_media (procurement_order_id, media_type, file_key, file_url, mime_type, size, uploaded_by, category, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [orderId, media_type, file_key, file_url, mime_type, size, userId, category, sort_order]
    )
    return rows[0]
  }

  async getCategorizedMedia(orderId) {
    const { rows } = await query(
      `SELECT * FROM procurement_media WHERE procurement_order_id = $1 ORDER BY category ASC, sort_order ASC, created_at ASC`,
      [orderId]
    )
    return rows
  }

  // ─── AUDIT TIMELINE ─────────────────────────────────
  async getAuditLogs(orderId) {
    const { rows } = await query(
      `SELECT a.*, u.email AS actor_email, u.name AS actor_name
         FROM procurement_audit_logs a
         LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.procurement_order_id = $1
        ORDER BY a.created_at DESC`,
      [orderId]
    )
    return rows
  }

  async getCombinedTimeline(orderId) {
    const auditLogs = await this.getAuditLogs(orderId)
    const comments = await this.getComments(orderId)
    const media = await this.getCategorizedMedia(orderId)

    const timeline = [
      ...auditLogs.map(a => ({ type: 'AUDIT', timestamp: a.created_at, payload: a })),
      ...comments.map(c => ({ type: 'COMMENT', timestamp: c.created_at, payload: c })),
      ...media.map(m => ({ type: 'EVIDENCE', timestamp: m.created_at, payload: m })),
    ]

    return timeline.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
  }
}
