/**
 * Orders Repository — Data Access Layer for Orders, Status History & Fulfilment Tasks
 * Source of truth: Blueprint §06.7, Phase 8
 *
 * @module modules/orders/orders.repository
 */

import { query } from '../../config/database.js'

export class OrdersRepository {
  /**
   * Allocate an order number inside the caller's transaction.  The sequence
   * table makes simultaneous checkouts safe while keeping the printed number
   * useful to customers and store staff: FC-HQC-YYYYMMDD-0001.
   */
  async generateCheckoutOrderNumber(client, shopId) {
    const { rows: shops } = await client.query(
      `SELECT COALESCE(NULLIF(order_prefix, ''), 'SHOP') AS order_prefix
         FROM shops WHERE id = $1 FOR SHARE`,
      [shopId]
    )
    if (!shops[0]) throw new Error('Store not found for order')

    const { rows } = await client.query(
      `INSERT INTO order_number_sequences (shop_id, order_date, last_value)
       VALUES ($1, CURRENT_DATE, 1)
       ON CONFLICT (shop_id, order_date)
       DO UPDATE SET last_value = order_number_sequences.last_value + 1
       RETURNING order_date, last_value`,
      [shopId]
    )
    const date = String(rows[0].order_date).slice(0, 10).replaceAll('-', '')
    const sequence = String(rows[0].last_value).padStart(4, '0')
    return `FC-${shops[0].order_prefix}-${date}-${sequence}`
  }

  /** Create a store-scoped checkout order and its immutable item snapshots. */
  async createCheckoutOrder(client, data) {
    const { rows } = await client.query(
      `INSERT INTO orders (
        order_number, customer_id, shop_id, status, items,
        subtotal, discount_amount, loyalty_redeemed_amount,
        delivery_fee, platform_fee, tax_amount, total_payable,
        payment_method, payment_status, coupon_code, delivery_address,
        delivery_notes, estimated_delivery
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
      )
      RETURNING *`,
      [
        data.orderNumber, data.customerId, data.shopId, data.status,
        JSON.stringify(data.items), data.subtotal, data.discountAmount || 0,
        0, data.deliveryFee || 0, data.platformFee || 0, data.taxAmount || 0,
        data.totalPayable, data.paymentMethod, data.paymentStatus,
        data.couponCode || null, JSON.stringify(data.deliveryAddress),
        data.deliveryNotes || null, data.estimatedDelivery || null,
      ]
    )

    for (const item of data.items) {
      await client.query(
        `INSERT INTO order_items (
          order_id, product_id, product_name, quantity, unit_price, subtotal,
          product_snapshot, shop_product_id, shop_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          rows[0].id, item.productId, item.name, item.quantity, item.price,
          item.total, JSON.stringify(item), item.shopProductId || null,
          data.shopId,
        ]
      )
    }
    return rows[0]
  }

  async findByIdAndUser(orderId, userId) {
    const { rows } = await query(
      `SELECT * FROM orders WHERE id = $1 AND customer_id = $2 LIMIT 1`,
      [orderId, userId]
    )
    return rows[0] ? this._formatCheckoutOrder(rows[0]) : null
  }

  _formatCheckoutOrder(row) {
    return {
      id: row.id,
      orderNumber: row.order_number,
      customerId: row.customer_id,
      shopId: row.shop_id || null,
      status: row.status,
      items: typeof row.items === 'string' ? JSON.parse(row.items) : row.items,
      subtotal: Number(row.subtotal || 0),
      discountAmount: Number(row.discount_amount || 0),
      deliveryFee: Number(row.delivery_fee || 0),
      platformFee: Number(row.platform_fee || 0),
      taxAmount: Number(row.tax_amount || 0),
      totalAmount: Number(row.total_payable || 0),
      paymentMethod: row.payment_method,
      paymentStatus: row.payment_status,
      couponCode: row.coupon_code || null,
      deliveryAddress: typeof row.delivery_address === 'string'
        ? JSON.parse(row.delivery_address)
        : row.delivery_address,
      deliveryNotes: row.delivery_notes || null,
      estimatedDelivery: row.estimated_delivery || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
  async createOrder({ order_number, quote_id, customer_id, warehouse_id = null, status = 'ORDER_PLACED', subtotal, discount_amount, loyalty_redeemed_amount, tax_amount, total_payable }) {
    const { rows } = await query(
      `INSERT INTO orders (order_number, quote_id, customer_id, warehouse_id, status, subtotal, discount_amount, loyalty_redeemed_amount, tax_amount, total_payable)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [order_number, quote_id, customer_id, warehouse_id, status, subtotal, discount_amount, loyalty_redeemed_amount, tax_amount, total_payable]
    )
    return rows[0]
  }

  async addOrderItem(orderId, itemData) {
    const { product_id, product_name, quantity, unit_price, subtotal, product_snapshot = {} } = itemData
    const { rows } = await query(
      `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, subtotal, product_snapshot)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [orderId, product_id, product_name, quantity, unit_price, subtotal, JSON.stringify(product_snapshot)]
    )
    return rows[0]
  }

  async findOrderById(orderId) {
    const { rows } = await query(`SELECT * FROM orders WHERE id = $1 LIMIT 1`, [orderId])
    if (!rows[0]) return null

    const order = rows[0]
    const itemsRes = await query(`SELECT * FROM order_items WHERE order_id = $1 ORDER BY created_at ASC`, [orderId])
    const tasksRes = await query(`SELECT * FROM fulfilment_tasks WHERE order_id = $1 ORDER BY created_at ASC`, [orderId])
    const historyRes = await query(`SELECT * FROM order_status_history WHERE order_id = $1 ORDER BY created_at ASC`, [orderId])

    return { ...order, items: itemsRes.rows, fulfilment_tasks: tasksRes.rows, status_history: historyRes.rows }
  }

  async findOrderByNumber(orderNumber) {
    const { rows } = await query(`SELECT id FROM orders WHERE order_number = $1 LIMIT 1`, [orderNumber])
    if (!rows[0]) return null
    return this.findOrderById(rows[0].id)
  }

  async findById(orderId) {
    return this.findOrderById(orderId)
  }

  async updateStatus(orderId, status, options = {}) {
    const setClauses = []
    const params = []

    if (status !== undefined) {
      setClauses.push(`status = $${params.length + 1}`)
      params.push(status)
    }

    if (options.paymentStatus !== undefined) {
      setClauses.push(`payment_status = $${params.length + 1}`)
      params.push(options.paymentStatus)
    }

    if (options.paymentExpiresAt !== undefined) {
      setClauses.push(`payment_expires_at = $${params.length + 1}`)
      params.push(options.paymentExpiresAt)
    }

    if (setClauses.length === 0) {
      return this.findOrderById(orderId)
    }

    params.push(orderId)
    const { rows } = await query(
      `UPDATE orders SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    )
    return rows[0]
  }

  async updateOrderStatus(orderId, status) {
    return this.updateStatus(orderId, status)
  }

  async logStatusTransition(orderId, fromStatus, toStatus, actorId = null, notes = null) {
    const { rows } = await query(
      `INSERT INTO order_status_history (order_id, from_status, to_status, actor_id, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [orderId, fromStatus, toStatus, actorId, notes]
    )
    return rows[0]
  }

  async createFulfilmentTask(orderId, taskType, assignedTo = null, notes = null) {
    const { rows } = await query(
      `INSERT INTO fulfilment_tasks (order_id, task_type, assigned_to, status, notes)
       VALUES ($1, $2, $3, 'PENDING', $4)
       RETURNING *`,
      [orderId, taskType, assignedTo, notes]
    )
    return rows[0]
  }

  async updateFulfilmentTaskStatus(taskId, status, notes = null) {
    const { rows } = await query(
      `UPDATE fulfilment_tasks SET status = $2, notes = COALESCE($3, notes) WHERE id = $1 RETURNING *`,
      [taskId, status, notes]
    )
    return rows[0]
  }

  async logAudit(orderId, actorId = null, action = '', payload = {}) {
    const { rows } = await query(
      `INSERT INTO order_audit_logs (order_id, actor_id, action, payload)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [orderId, actorId, action, JSON.stringify(payload)]
    )
    return rows[0]
  }

  async listOrders(customerId = null, warehouseId = null, status = null) {
    const conditions = ['1=1']
    const params = []
    let idx = 1

    if (customerId) {
      conditions.push(`customer_id = $${idx}`)
      params.push(customerId)
      idx++
    }

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

    const { rows } = await query(
      `SELECT * FROM orders WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
      params
    )
    return rows
  }
}
