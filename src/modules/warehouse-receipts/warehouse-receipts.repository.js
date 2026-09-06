/**
 * Warehouse Receipts Repository — Data Access Layer for Receipts & QC Inspections
 * Source of truth: Blueprint §06.4, Phase 5A
 *
 * @module modules/warehouse-receipts/warehouse-receipts.repository
 */

import { query } from '../../config/database.js'

export class WarehouseReceiptsRepository {
  async createReceipt(warehouseId, procurementOrderId, receiptNumber, receivedBy = null, notes = null) {
    const { rows } = await query(
      `INSERT INTO warehouse_receipts (warehouse_id, procurement_order_id, receipt_number, received_by, notes, status)
       VALUES ($1, $2, $3, $4, $5, 'PENDING_RECEIPT')
       RETURNING *`,
      [warehouseId, procurementOrderId, receiptNumber, receivedBy, notes]
    )
    return rows[0]
  }

  async addReceiptItem(receiptId, itemData) {
    const { batch_id = null, product_id, quantity_received } = itemData
    const { rows } = await query(
      `INSERT INTO warehouse_receipt_items (warehouse_receipt_id, batch_id, product_id, quantity_received)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [receiptId, batch_id, product_id, quantity_received]
    )
    return rows[0]
  }

  async findReceiptById(id) {
    const { rows } = await query(
      `SELECT * FROM warehouse_receipts WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [id]
    )
    if (!rows[0]) return null

    const receipt = rows[0]
    const itemsRes = await query(
      `SELECT ri.*, p.name AS product_name, b.batch_number
         FROM warehouse_receipt_items ri
         JOIN products p ON p.id = ri.product_id
         LEFT JOIN procurement_batches b ON b.id = ri.batch_id
        WHERE ri.warehouse_receipt_id = $1`,
      [id]
    )
    const qcRes = await query(
      `SELECT * FROM quality_inspections WHERE warehouse_receipt_id = $1 ORDER BY created_at DESC`,
      [id]
    )

    return { ...receipt, items: itemsRes.rows, inspections: qcRes.rows }
  }

  async updateReceiptStatus(id, status) {
    const { rows } = await query(
      `UPDATE warehouse_receipts SET status = $2 WHERE id = $1 RETURNING *`,
      [id, status]
    )
    return rows[0]
  }

  async updateItemQuantities(itemId, accepted, rejected) {
    const { rows } = await query(
      `UPDATE warehouse_receipt_items SET quantity_accepted = $2, quantity_rejected = $3 WHERE id = $1 RETURNING *`,
      [itemId, accepted, rejected]
    )
    return rows[0]
  }

  async createInspection(receiptId, inspectorId, result, notes = null) {
    const { rows } = await query(
      `INSERT INTO quality_inspections (warehouse_receipt_id, inspector_id, result, notes)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [receiptId, inspectorId, result, notes]
    )
    return rows[0]
  }

  async addInspectionResult(inspectionId, receiptItemId, parameterName, status, remarks = null) {
    const { rows } = await query(
      `INSERT INTO quality_inspection_results (quality_inspection_id, receipt_item_id, parameter_name, status, remarks)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [inspectionId, receiptItemId, parameterName, status, remarks]
    )
    return rows[0]
  }

  async logAudit({ receiptId, actorId = null, action, previousStatus = null, newStatus = null, comments = null }) {
    const { rows } = await query(
      `INSERT INTO warehouse_receipt_audits (warehouse_receipt_id, actor_id, action, previous_status, new_status, comments)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [receiptId, actorId, action, previousStatus, newStatus, comments]
    )
    return rows[0]
  }

  async listReceipts({ warehouseId = null, status = null, page = 1, limit = 20 }) {
    const offset = (page - 1) * limit
    const conditions = ['deleted_at IS NULL']
    const params = []
    let idx = 1

    if (warehouseId) {
      conditions.push(`warehouse_id = $${idx}`)
      params.push(warehouseId)
      idx++
    }

    if (status) {
      conditions.push(`status = $${idx}`)
      params.push(status)
      idx++
    }

    const whereClause = conditions.join(' AND ')

    const countRes = await query(`SELECT COUNT(*)::int AS total FROM warehouse_receipts WHERE ${whereClause}`, params)
    const total = countRes.rows[0]?.total || 0

    const dataRes = await query(
      `SELECT * FROM warehouse_receipts
        WHERE ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    )

    return { data: dataRes.rows, total }
  }
}
