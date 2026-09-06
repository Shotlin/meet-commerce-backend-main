import { query } from '../../../config/database.js'

const LIST_SELECT = `
  SELECT
    rr.*,
    o.order_number,
    o.total_payable AS order_total_payable,
    o.status AS order_status,
    u.name AS customer_name,
    u.phone AS customer_phone
  FROM refund_requests rr
  JOIN orders o ON o.id = rr.order_id
  JOIN users u ON u.id = rr.customer_id
`

export class ReturnsRepository {
  async findAll({ status, customerId, orderId, page = 1, limit = 20 }) {
    const conditions = []
    const params = []
    let idx = 1

    if (status) {
      conditions.push(`rr.status = $${idx++}`)
      params.push(status)
    }
    if (customerId) {
      conditions.push(`rr.customer_id = $${idx++}`)
      params.push(customerId)
    }
    if (orderId) {
      conditions.push(`rr.order_id = $${idx++}`)
      params.push(orderId)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const offset = (page - 1) * limit

    const { rows } = await query(
      `${LIST_SELECT} ${where} ORDER BY rr.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset]
    )

    const { rows: countRows } = await query(
      `SELECT COUNT(*) AS total FROM refund_requests rr ${where}`,
      params
    )

    return { rows, total: Number(countRows[0].total) }
  }

  async findById(id) {
    const { rows: [row] } = await query(`${LIST_SELECT} WHERE rr.id = $1`, [id])
    return row || null
  }

  /** Real order data needed to validate a return request and compute its amount. */
  async findOrderForReturn(orderId) {
    const { rows: [order] } = await query(
      `SELECT id, customer_id, status, total_payable, items
       FROM orders WHERE id = $1`,
      [orderId]
    )
    return order || null
  }

  async create(data) {
    const { rows: [row] } = await query(
      `INSERT INTO refund_requests (
         order_id, customer_id, scope, items, reason, refund_destination,
         computed_amount, admin_notes, requested_by
       )
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        data.orderId,
        data.customerId,
        data.scope,
        data.items ? JSON.stringify(data.items) : null,
        data.reason,
        data.refundDestination,
        data.computedAmount,
        data.adminNotes || null,
        data.requestedBy,
      ]
    )
    return row
  }

  async resolve(id, { status, resolvedAmount, resolvedBy, adminNotes }) {
    const { rows: [row] } = await query(
      `UPDATE refund_requests
       SET status = $1,
           resolved_amount = $2,
           resolved_by = $3,
           resolved_at = NOW(),
           admin_notes = COALESCE($4, admin_notes),
           updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [status, resolvedAmount, resolvedBy, adminNotes ?? null, id]
    )
    return row || null
  }
}
