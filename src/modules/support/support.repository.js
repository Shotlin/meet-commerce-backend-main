/**
 * Support & Traceability Repository — Data Access Layer
 * Source of truth: Blueprint §06.9, Phase 10
 *
 * @module modules/support/support.repository
 */

import { query } from '../../config/database.js'

export class SupportRepository {
  // ─── TICKETS ────────────────────────────────────────
  async createTicket(ticketNumber, userId, subject, description) {
    const { rows } = await query(
      `INSERT INTO support_tickets (ticket_number, user_id, subject, description, status)
       VALUES ($1, $2, $3, $4, 'OPEN')
       RETURNING *`,
      [ticketNumber, userId, subject, description]
    )
    return rows[0]
  }

  async findTicketById(ticketId) {
    const { rows } = await query(`SELECT * FROM support_tickets WHERE id = $1 LIMIT 1`, [ticketId])
    if (!rows[0]) return null

    const ticket = rows[0]
    const commentsRes = await query(`SELECT tc.*, u.email AS author_email FROM ticket_comments tc LEFT JOIN users u ON u.id = tc.user_id WHERE tc.ticket_id = $1 ORDER BY tc.created_at ASC`, [ticketId])
    const historyRes = await query(`SELECT * FROM ticket_status_history WHERE ticket_id = $1 ORDER BY created_at ASC`, [ticketId])

    return { ...ticket, comments: commentsRes.rows, status_history: historyRes.rows }
  }

  async assignTicket(ticketId, assignedTo) {
    const { rows } = await query(
      `UPDATE support_tickets SET assigned_to = $2, status = CASE WHEN status = 'OPEN' THEN 'ASSIGNED' ELSE status END, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [ticketId, assignedTo]
    )
    return rows[0]
  }

  async updateTicketStatus(ticketId, status) {
    const { rows } = await query(
      `UPDATE support_tickets SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [ticketId, status]
    )
    return rows[0]
  }

  async addTicketComment(ticketId, userId, comment) {
    const { rows } = await query(
      `INSERT INTO ticket_comments (ticket_id, user_id, comment)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [ticketId, userId, comment]
    )
    return rows[0]
  }

  async logStatusTransition(ticketId, fromStatus, toStatus, actorId = null, notes = null) {
    const { rows } = await query(
      `INSERT INTO ticket_status_history (ticket_id, from_status, to_status, actor_id, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [ticketId, fromStatus, toStatus, actorId, notes]
    )
    return rows[0]
  }

  // ─── RECALLS ────────────────────────────────────────
  async createRecall(recallNumber, title, reason, initiatedBy = null) {
    const { rows } = await query(
      `INSERT INTO product_recalls (recall_number, title, reason, status, initiated_by)
       VALUES ($1, $2, $3, 'DRAFT', $4)
       RETURNING *`,
      [recallNumber, title, reason, initiatedBy]
    )
    return rows[0]
  }

  async addRecallItem(recallId, productId, batchId = null, batchNumber = null, affectedQuantity = 0) {
    const { rows } = await query(
      `INSERT INTO recall_items (recall_id, product_id, batch_id, batch_number, affected_quantity)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [recallId, productId, batchId, batchNumber, affectedQuantity]
    )
    return rows[0]
  }

  async updateRecallStatus(recallId, status) {
    const { rows } = await query(
      `UPDATE product_recalls SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [recallId, status]
    )
    return rows[0]
  }

  async findRecallById(recallId) {
    const { rows } = await query(`SELECT * FROM product_recalls WHERE id = $1 LIMIT 1`, [recallId])
    if (!rows[0]) return null
    const itemsRes = await query(`SELECT * FROM recall_items WHERE recall_id = $1`, [recallId])
    return { ...rows[0], items: itemsRes.rows }
  }

  async listRecalls(recallId = null) {
    const { rows } = await query(
      `SELECT r.id, r.recall_number, r.title, r.reason, r.status, r.created_at,
              COALESCE(i.batch_number, '') AS lot_number,
              COALESCE(SUM(ri.affected_quantity), 0) AS affected_units
         FROM product_recalls r
         LEFT JOIN recall_items ri ON ri.recall_id = r.id
         LEFT JOIN LATERAL (
           SELECT batch_number FROM recall_items WHERE recall_id = r.id LIMIT 1
         ) i ON true
        WHERE $1::uuid IS NULL OR r.id = $1
        GROUP BY r.id, i.batch_number
        ORDER BY r.created_at DESC`,
      [recallId]
    )
    return recallId ? rows[0] || null : rows
  }

  // ─── TRACEABILITY (APPEND-ONLY) ─────────────────────
  async recordTraceabilityEvent({ event_type, product_id, batch_number = null, warehouse_id = null, procurement_order_id = null, recall_id = null, actor_id = null, payload = {} }) {
    const { rows } = await query(
      `INSERT INTO traceability_events (event_type, product_id, batch_number, warehouse_id, procurement_order_id, recall_id, actor_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [event_type, product_id, batch_number, warehouse_id, procurement_order_id, recall_id, actor_id, JSON.stringify(payload)]
    )
    return rows[0]
  }

  async getTraceabilityHistory(productId, batchNumber = null) {
    const conditions = ['product_id = $1']
    const params = [productId]

    if (batchNumber) {
      conditions.push('batch_number = $2')
      params.push(batchNumber)
    }

    const { rows } = await query(
      `SELECT te.*, p.name AS product_name
         FROM traceability_events te
         JOIN products p ON p.id = te.product_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY te.created_at DESC`,
      params
    )
    return rows
  }

  async listTickets(userId = null) {
    const where = userId ? 'WHERE user_id = $1' : ''
    const params = userId ? [userId] : []
    const { rows } = await query(`SELECT * FROM support_tickets ${where} ORDER BY created_at DESC`, params)
    return rows
  }
}
