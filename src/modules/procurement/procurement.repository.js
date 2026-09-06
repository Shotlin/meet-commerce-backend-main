/**
 * Procurement Repository — Data Access Layer for Procurement, Receipts & Batches
 * Source of truth: Blueprint §06.3, Phase 4A
 *
 * @module modules/procurement/procurement.repository
 */

import { query } from '../../config/database.js'

export class ProcurementRepository {
  async createProcurementOrder(vendorId, orderNumber, notes = null, totalCost = 0) {
    const { rows } = await query(
      `INSERT INTO procurement_orders (vendor_id, order_number, notes, total_cost, status)
       VALUES ($1, $2, $3, $4, 'DRAFT')
       RETURNING *`,
      [vendorId, orderNumber, notes, totalCost]
    )
    return rows[0]
  }

  async addProcurementItem(orderId, itemData) {
    const { product_id, quantity_ordered, unit_cost } = itemData
    const { rows } = await query(
      `INSERT INTO procurement_items (procurement_order_id, product_id, quantity_ordered, unit_cost)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [orderId, product_id, quantity_ordered, unit_cost]
    )
    return rows[0]
  }

  async findOrderById(id) {
    const { rows } = await query(
      `SELECT * FROM procurement_orders WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [id]
    )
    if (!rows[0]) return null

    const order = rows[0]
    const itemsRes = await query(
      `SELECT pi.*, p.name AS product_name
         FROM procurement_items pi
         JOIN products p ON p.id = pi.product_id
        WHERE pi.procurement_order_id = $1`,
      [id]
    )
    const batchesRes = await query(
      `SELECT * FROM procurement_batches WHERE procurement_order_id = $1`,
      [id]
    )

    return { ...order, items: itemsRes.rows, batches: batchesRes.rows }
  }

  async updateOrderStatus(id, status) {
    const { rows } = await query(
      `UPDATE procurement_orders SET status = $2 WHERE id = $1 RETURNING *`,
      [id, status]
    )
    return rows[0]
  }

  async findItemById(itemId) {
    const { rows } = await query(`SELECT * FROM procurement_items WHERE id = $1 LIMIT 1`, [itemId])
    return rows[0] || null
  }

  async updateItemQuantityReceived(itemId, additionalReceived) {
    const { rows } = await query(
      `UPDATE procurement_items SET quantity_received = quantity_received + $2 WHERE id = $1 RETURNING *`,
      [itemId, additionalReceived]
    )
    return rows[0]
  }

  async findDuplicateBatchNumber(batchNumber) {
    const { rows } = await query(
      `SELECT id FROM procurement_batches WHERE batch_number = $1 LIMIT 1`,
      [batchNumber]
    )
    return rows[0] || null
  }

  async createBatch({ procurement_order_id, procurement_item_id, batch_number, quantity, manufactured_date = null, expiry_date = null }) {
    const { rows } = await query(
      `INSERT INTO procurement_batches (procurement_order_id, procurement_item_id, batch_number, quantity, manufactured_date, expiry_date)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [procurement_order_id, procurement_item_id, batch_number, quantity, manufactured_date, expiry_date]
    )
    return rows[0]
  }

  async addMedia(orderId, mediaData, actorId = null) {
    const { media_type, file_key, file_url = null, mime_type = null, size = null } = mediaData
    const { rows } = await query(
      `INSERT INTO procurement_media (procurement_order_id, media_type, file_key, file_url, mime_type, size, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [orderId, media_type, file_key, file_url, mime_type, size, actorId]
    )
    return rows[0]
  }

  async getMedia(orderId) {
    const { rows } = await query(
      `SELECT * FROM procurement_media WHERE procurement_order_id = $1 ORDER BY created_at DESC`,
      [orderId]
    )
    return rows
  }

  async logAudit({ orderId, actorId = null, action, previousStatus = null, newStatus = null, comments = null }) {
    const { rows } = await query(
      `INSERT INTO procurement_audit_logs (procurement_order_id, actor_id, action, previous_status, new_status, comments)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [orderId, actorId, action, previousStatus, newStatus, comments]
    )
    return rows[0]
  }

  async listOrders({ vendorId = null, status = null, page = 1, limit = 20 }) {
    const offset = (page - 1) * limit
    const conditions = ['deleted_at IS NULL']
    const params = []
    let idx = 1

    if (vendorId) {
      conditions.push(`vendor_id = $${idx}`)
      params.push(vendorId)
      idx++
    }

    if (status) {
      conditions.push(`status = $${idx}`)
      params.push(status)
      idx++
    }

    const whereClause = conditions.join(' AND ')

    const countRes = await query(`SELECT COUNT(*)::int AS total FROM procurement_orders WHERE ${whereClause}`, params)
    const total = countRes.rows[0]?.total || 0

    const dataRes = await query(
      `SELECT * FROM procurement_orders
        WHERE ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    )

    return { data: dataRes.rows, total }
  }
}
