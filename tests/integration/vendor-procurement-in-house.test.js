/**
 * In-house procurement against real PostgreSQL.
 *
 * Covers the Phase 1 contract:
 *   record in-house purchase -> attach quality video -> mark arrived ->
 *   confirm receipt -> inventory lot + shop stock -> customer quality-video
 *   trace (the existing order QR/API path).
 *
 * SKIPS itself when no database is reachable. Fixtures deleted in afterAll.
 * Run this file only against an isolated test database.
 */

import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { config } from 'dotenv'
import pg from 'pg'

config()

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
}

let dbUp = false
try {
  const probe = new pg.Pool({ ...dbConfig, max: 1, connectionTimeoutMillis: 2000 })
  await probe.query('SELECT 1')
  await probe.end()
  dbUp = true
} catch {
  dbUp = false
}

import { VendorProcurementService } from '../../src/modules/vendor-procurement/vendor-procurement.service.js'
import { InventoryService } from '../../src/modules/inventory/inventory.service.js'
import { InventoryRepository } from '../../src/modules/inventory/inventory.repository.js'
import { query, closePool } from '../../src/config/database.js'

const suffix = Math.random().toString(36).slice(2, 10)
const ids = {}

beforeAll(async () => {
  if (!dbUp) return

  const shop = await query(
    `INSERT INTO shops (name, slug, branch_code, address_line1, city, state, pincode, lat, lng, serviceable_pincodes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [
      `In-house Store ${suffix}`,
      `in-house-store-${suffix}`,
      `IH${suffix.slice(0, 6)}`,
      '1 In-house Lane',
      'Kolkata',
      'West Bengal',
      '700001',
      22.5726,
      88.3639,
      ['700001'],
    ]
  )
  ids.shop = shop.rows[0].id

  const category = await query(
    `INSERT INTO categories (name, slug) VALUES ($1, $2) RETURNING id`,
    [`In-house Chicken ${suffix}`, `in-house-chicken-${suffix}`]
  )
  ids.category = category.rows[0].id

  const product = await query(
    `INSERT INTO products (name, slug, price, category_id, unit, is_active)
     VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
    [`In-house Chicken ${suffix}`, `in-house-chicken-product-${suffix}`, 120, ids.category, 'kg']
  )
  ids.product = product.rows[0].id

  const inactiveProduct = await query(
    `INSERT INTO products (name, slug, price, category_id, unit, is_active)
     VALUES ($1, $2, $3, $4, $5, false) RETURNING id`,
    [`In-house Inactive ${suffix}`, `in-house-inactive-${suffix}`, 100, ids.category, 'kg']
  )
  ids.inactiveProduct = inactiveProduct.rows[0].id

  const shopProduct = await query(
    `INSERT INTO shop_products (shop_id, product_id, price, stock_quantity)
     VALUES ($1, $2, $3, 0) RETURNING id`,
    [ids.shop, ids.product, 140]
  )
  ids.shopProduct = shopProduct.rows[0].id

  const customer = await query(
    `INSERT INTO users (phone, name) VALUES ($1, $2) RETURNING id`,
    [`90000${suffix.replace(/\D/g, '').padEnd(5, '1').slice(0, 5)}`, `In-house Test Customer ${suffix}`]
  )
  ids.customer = customer.rows[0].id
})

afterAll(async () => {
  if (!dbUp) return

  if (ids.orderItem) {
    await query(`DELETE FROM order_item_inventory_allocations WHERE order_item_id = $1`, [ids.orderItem])
    await query(`DELETE FROM order_items WHERE id = $1`, [ids.orderItem])
  }
  if (ids.order) await query(`DELETE FROM orders WHERE id = $1`, [ids.order])
  if (ids.customer) await query(`DELETE FROM users WHERE id = $1`, [ids.customer])

  if (ids.shop) {
    await query(`DELETE FROM stock_movements WHERE shop_id = $1`, [ids.shop])
  }
  if (ids.warehouse) {
    await query(`DELETE FROM inventory_lots WHERE warehouse_id = $1`, [ids.warehouse])
  }
  if (ids.supply) {
    await query(`DELETE FROM procurement_receipt_items WHERE receipt_id IN (SELECT id FROM procurement_receipts WHERE supply_order_id = $1)`, [ids.supply])
    await query(`DELETE FROM procurement_receipts WHERE supply_order_id = $1`, [ids.supply])
    await query(`DELETE FROM procurement_evidence WHERE supply_order_id = $1`, [ids.supply])
    await query(`DELETE FROM procurement_supply_events WHERE supply_order_id = $1`, [ids.supply])
    await query(`DELETE FROM procurement_supply_order_items WHERE supply_order_id = $1`, [ids.supply])
    await query(`DELETE FROM procurement_supply_orders WHERE id = $1`, [ids.supply])
  }
  if (ids.shopProduct) await query(`DELETE FROM shop_products WHERE id = $1`, [ids.shopProduct])
  if (ids.product) await query(`DELETE FROM products WHERE id = $1`, [ids.product])
  if (ids.inactiveProduct) await query(`DELETE FROM products WHERE id = $1`, [ids.inactiveProduct])
  if (ids.category) await query(`DELETE FROM categories WHERE id = $1`, [ids.category])
  if (ids.shop) await query(`DELETE FROM shops WHERE id = $1`, [ids.shop])

  await closePool()
})

describe.skipIf(!dbUp)('in-house procurement', () => {
  const service = new VendorProcurementService()

  it('records an in-house purchase with no vendor or request', async () => {
    const supply = await service.createInHouseSupply(
      null,
      {
        shop_id: ids.shop,
        in_house_supplier_name: 'Local Market',
        items: [
          {
            product_id: ids.product,
            quantity: 5,
            unit: 'KG',
            unit_price: 120,
          },
        ],
      },
      { scopedShopId: ids.shop }
    )
    ids.supply = supply.id

    expect(supply.source_type).toBe('IN_HOUSE')
    expect(supply.vendor_id).toBeNull()
    expect(supply.request_id).toBeNull()
    expect(supply.in_house_supplier_name).toBe('Local Market')
    expect(supply.status).toBe('ACCEPTED')
    expect(Number(supply.award_amount)).toBe(600)
    expect(supply.items).toHaveLength(1)
    expect(supply.items[0].product_id).toBe(ids.product)
  })

  it('rejects invalid in-house lines', async () => {
    await expect(
      service.createInHouseSupply(
        null,
        { shop_id: ids.shop, items: [{ product_id: ids.product, quantity: 0, unit: 'KG', unit_price: 10 }] },
        { scopedShopId: ids.shop }
      )
    ).rejects.toMatchObject({ code: 'IN_HOUSE_QUANTITY_INVALID' })

    await expect(
      service.createInHouseSupply(
        null,
        { shop_id: ids.shop, items: [{ product_id: ids.inactiveProduct, quantity: 1, unit: 'KG', unit_price: 10 }] },
        { scopedShopId: ids.shop }
      )
    ).rejects.toMatchObject({ code: 'IN_HOUSE_PRODUCT_INVALID' })
  })

  it('marks the purchase arrived but blocks receipt until a video exists', async () => {
    const arrived = await service.markInHouseArrived(ids.supply, null, { scopedShopId: ids.shop })
    expect(arrived.status).toBe('DELIVERED_PENDING_RECEIPT')
    expect(arrived.delivered_at).toBeTruthy()

    const detail = await service.getSupplyOrder(ids.supply, { scopedShopId: ids.shop })
    await expect(
      service.receiveSupply(
        ids.supply,
        null,
        {
          items: [
            {
              supply_order_item_id: detail.items[0].id,
              received_quantity: 5,
              accepted_quantity: 5,
              rejected_quantity: 0,
              product_id: ids.product,
            },
          ],
        },
        { scopedShopId: ids.shop }
      )
    ).rejects.toMatchObject({ code: 'IN_HOUSE_EVIDENCE_REQUIRED' })
  })

  it('attaches an external quality video as accepted, with no vendor', async () => {
    const evidence = await service.attachInHouseEvidence(
      ids.supply,
      null,
      { media_url: 'https://example.test/in-house-quality.mp4' },
      { scopedShopId: ids.shop }
    )

    expect(evidence.vendor_id).toBeNull()
    expect(evidence.media_public_id).toBeNull()
    expect(evidence.attachment_source).toBe('EXTERNAL_LINK')
    expect(evidence.review_status).toBe('ACCEPTED')
    expect(evidence.media_url).toBe('https://example.test/in-house-quality.mp4')
  })

  it('receives stock into an inventory lot and updates shop stock', async () => {
    const detail = await service.getSupplyOrder(ids.supply, { scopedShopId: ids.shop })
    const result = await service.receiveSupply(
      ids.supply,
      null,
      {
        items: [
          {
            supply_order_item_id: detail.items[0].id,
            received_quantity: 5,
            accepted_quantity: 5,
            rejected_quantity: 0,
            product_id: ids.product,
          },
        ],
      },
      { scopedShopId: ids.shop }
    )

    expect(result.receipt.status).toBe('RECEIVED')
    expect(result.supply_order.status).toBe('RECEIVED')
    expect(result.inventory).toHaveLength(1)
    expect(result.inventory[0].inventory_skipped).toBe(false)
    expect(result.inventory[0].inventory_lot_id).toBeTruthy()
    expect(result.inventory[0].shop_stock_linked).toBe(true)
    ids.lot = result.inventory[0].inventory_lot_id

    const shopProduct = await query(`SELECT stock_quantity FROM shop_products WHERE id = $1`, [ids.shopProduct])
    expect(shopProduct.rows[0].stock_quantity).toBe(5)

    const lot = await query(`SELECT warehouse_id FROM inventory_lots WHERE id = $1`, [ids.lot])
    ids.warehouse = lot.rows[0].warehouse_id
  })

  it('resolves the in-house video through the existing customer quality trace', async () => {
    const order = await query(
      `INSERT INTO orders (order_number, customer_id, items, subtotal, total_payable, delivery_address)
       VALUES ($1, $2, '[]'::jsonb, 140, 140, '{}'::jsonb) RETURNING id`,
      [`IH-${suffix}`, ids.customer]
    )
    ids.order = order.rows[0].id

    const orderItem = await query(
      `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal, product_snapshot)
       VALUES ($1, $2, $3, 140, 1, 140, '{}'::jsonb) RETURNING id`,
      [ids.order, ids.product, `In-house Chicken ${suffix}`]
    )
    ids.orderItem = orderItem.rows[0].id

    await query(
      `INSERT INTO order_item_inventory_allocations (order_item_id, inventory_lot_id, quantity_allocated)
       VALUES ($1, $2, 1)`,
      [ids.orderItem, ids.lot]
    )

    const trace = await new InventoryService(new InventoryRepository()).getQualityTraceForOrderItems([
      ids.orderItem,
    ])
    expect(trace).toHaveLength(1)
    expect(trace[0].vendor_name).toBe('FreshCuts In-house')
    expect(trace[0].video_url).toBe('https://example.test/in-house-quality.mp4')
    expect(trace[0].supply_number).toBeTruthy()
  })

  it('serves the in-house video through the authenticated customer order API', async () => {
    const Fastify = (await import('fastify')).default
    const app = Fastify({ logger: false })
    try {
      await app.register(import('../../src/plugins/errorHandler.plugin.js'))
      await app.register(import('../../src/plugins/auth.plugin.js'))
      const { ordersRoutes } = await import('../../src/modules/orders/orders.routes.js')
      await app.register(ordersRoutes, { prefix: '/api/v1/orders' })
      await app.ready()
      const url = `/api/v1/orders/${ids.order}/quality-videos`
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401)
      const other = app.jwt.sign({ id: '11111111-1111-4111-8111-111111111111', role: 'CUSTOMER' })
      expect((await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${other}` } })).statusCode).toBe(403)
      const customer = app.jwt.sign({ id: ids.customer, role: 'CUSTOMER' })
      const response = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${customer}` } })
      expect(response.statusCode).toBe(200)
      expect(response.json().data.items).toHaveLength(1)
      expect(response.json().data.items[0].video).toMatchObject({ url: 'https://example.test/in-house-quality.mp4', vendorName: 'FreshCuts In-house' })
    } finally {
      await app.close()
    }
  })

  it('rejects a vendor review for an in-house purchase', async () => {
    await expect(
      service.submitReview(
        ids.supply,
        null,
        {
          rating_freshness: 5,
          rating_cleaning: 5,
          rating_packaging: 5,
          rating_quantity_accuracy: 5,
          rating_punctuality: 5,
          rating_overall: 5,
        },
        { scopedShopId: ids.shop }
      )
    ).rejects.toMatchObject({ code: 'IN_HOUSE_REVIEW_NOT_APPLICABLE' })
  })

  it('enforces shop scope on in-house reads', async () => {
    await expect(
      service.getSupplyOrder(ids.supply, { scopedShopId: '00000000-0000-0000-0000-000000000000' })
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('does not expose an in-house row to vendor-side mutations', async () => {
    await expect(
      service.updateSupplyStatus(ids.supply, null, null, 'ACCEPTED')
    ).rejects.toMatchObject({ statusCode: 404 })

    await expect(
      service.attachEvidence(ids.supply, null, null, {
        media_public_id: 'vendor-should-not-write-this',
        media_url: 'https://example.test/vendor-should-not-write-this.mp4',
      })
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('filters the supply list by source and exposes the in-house supplier', async () => {
    const result = await service.listSupplyOrders(
      { source_type: 'IN_HOUSE' },
      { scopedShopId: ids.shop }
    )
    const row = result.supplies.find((supply) => supply.id === ids.supply)

    expect(row).toBeTruthy()
    expect(row.source_type).toBe('IN_HOUSE')
    expect(row.vendor_id).toBeNull()
    expect(row.vendor_name).toBeNull()
    expect(row.in_house_supplier_name).toBe('Local Market')
  })
})
