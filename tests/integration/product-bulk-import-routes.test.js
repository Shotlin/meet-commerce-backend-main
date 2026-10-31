/**
 * Route-level smoke test for the product bulk-import endpoints.
 *
 * Proves the multipart wiring, admin auth, X-Shop-Id shop scope, template
 * download and preview/commit response shape through the real Fastify app.
 *
 * SKIPS itself when no database is reachable. Run only against an isolated
 * test database.
 */

import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { config } from 'dotenv'
import pg from 'pg'
import bcrypt from 'bcrypt'

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

import { buildApp } from '../../src/app.js'
import { query, closePool } from '../../src/config/database.js'

const suffix = Math.random().toString(36).slice(2, 10)
const password = `BulkRoute@${suffix}`
const email = `bulk-route-${suffix}@example.test`
const ids = {}

function multipart(filename, content, contentType) {
  const boundary = `----freshcuts-bulk-route-${suffix}`
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
  return { payload: Buffer.concat([head, content, tail]), boundary }
}

const csv = [
  'product_name,category,price,stock_quantity,unit,sku',
  `Route Bulk Product ${suffix},Route Bulk Category ${suffix},75,4,kg,ROUTE-BULK-${suffix}`,
].join('\r\n')

beforeAll(async () => {
  if (!dbUp) return

  const shop = await query(
    `INSERT INTO shops (name, slug, branch_code, address_line1, city, state, pincode, lat, lng, serviceable_pincodes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [
      `Route Bulk Store ${suffix}`,
      `route-bulk-store-${suffix}`,
      `RB${suffix.slice(0, 6)}`,
      '1 Route Bulk Road',
      'Kolkata',
      'West Bengal',
      '700001',
      22.5726,
      88.3639,
      ['700001'],
    ]
  )
  ids.shop = shop.rows[0].id

  const shop2 = await query(
    `INSERT INTO shops (name, slug, branch_code, address_line1, city, state, pincode, lat, lng, serviceable_pincodes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [
      `Route Bulk Store Two ${suffix}`,
      `route-bulk-store-two-${suffix}`,
      `RC${suffix.slice(0, 6)}`,
      '2 Route Bulk Road',
      'Kolkata',
      'West Bengal',
      '700001',
      22.5726,
      88.3639,
      ['700001'],
    ]
  )
  ids.shop2 = shop2.rows[0].id

  const category = await query(
    `INSERT INTO categories (name, slug) VALUES ($1, $2) RETURNING id`,
    [`Route Bulk Category ${suffix}`, `route-bulk-category-${suffix}`]
  )
  ids.category = category.rows[0].id

  const role = await query(`SELECT id FROM roles WHERE name = 'Super Admin' LIMIT 1`)
  const user = await query(
    `INSERT INTO users (phone, email, name, role, role_id, platform_role, password_hash, is_active, is_blocked)
     VALUES ($1, $2, $3, 'ADMIN', $4, 'SUPER_ADMIN', $5, true, false)
     RETURNING id`,
    [
      `98${suffix.replace(/\D/g, '').padEnd(8, '1').slice(0, 8)}`,
      email,
      `Bulk Route Admin ${suffix}`,
      role.rows[0]?.id ?? null,
      await bcrypt.hash(password, 4),
    ]
  )
  ids.user = user.rows[0].id

  ids.app = await buildApp()
  await ids.app.ready()

  const login = await ids.app.inject({
    method: 'POST',
    url: '/api/v1/admin/auth/login',
    payload: { email, password },
  })
  expect(login.statusCode).toBe(200)
  ids.token = login.json().data.accessToken
  expect(ids.token).toBeTruthy()
})

afterAll(async () => {
  if (!dbUp) return
  try {
    if (ids.app) await ids.app.close()
  } catch {
    // Best-effort shutdown.
  }
  if (ids.shop) await query(`DELETE FROM shop_products WHERE shop_id = $1`, [ids.shop])
  if (ids.shop2) await query(`DELETE FROM shop_products WHERE shop_id = $1`, [ids.shop2])
  if (ids.category) await query(`DELETE FROM products WHERE category_id = $1`, [ids.category])
  if (ids.category) await query(`DELETE FROM categories WHERE id = $1`, [ids.category])
  if (ids.shop) await query(`DELETE FROM shops WHERE id = $1`, [ids.shop])
  if (ids.shop2) await query(`DELETE FROM shops WHERE id = $1`, [ids.shop2])
  if (ids.user) {
    await query(`DELETE FROM admin_activity_log WHERE admin_id = $1`, [ids.user])
    await query(`DELETE FROM audit_logs WHERE actor_user_id = $1`, [ids.user])
    await query(`DELETE FROM users WHERE id = $1`, [ids.user])
  }
  await closePool()
})

describe.skipIf(!dbUp)('product bulk-import routes', () => {
  it('downloads the XLSX and CSV templates', async () => {
    const xlsx = await ids.app.inject({
      method: 'GET',
      url: '/api/v1/products/bulk-import/template?format=xlsx',
      headers: { authorization: `Bearer ${ids.token}` },
    })
    expect(xlsx.statusCode).toBe(200)
    expect(xlsx.headers['content-type']).toContain('spreadsheetml.sheet')
    expect((xlsx.rawPayload ?? Buffer.from(xlsx.body)).length).toBeGreaterThan(1000)

    const csvRes = await ids.app.inject({
      method: 'GET',
      url: '/api/v1/products/bulk-import/template?format=csv',
      headers: { authorization: `Bearer ${ids.token}` },
    })
    expect(csvRes.statusCode).toBe(200)
    expect(csvRes.headers['content-type']).toContain('text/csv')
    expect(csvRes.body.startsWith('product_name,category,price,stock_quantity,unit')).toBe(true)
  })

  it('requires a store scope for preview', async () => {
    const file = multipart('products.csv', Buffer.from(csv), 'text/csv')
    const res = await ids.app.inject({
      method: 'POST',
      url: '/api/v1/products/bulk-import/preview?mode=ADD_ONLY',
      headers: {
        authorization: `Bearer ${ids.token}`,
        'content-type': `multipart/form-data; boundary=${file.boundary}`,
      },
      payload: file.payload,
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('SHOP_SCOPE_REQUIRED')
  })

  it('previews and commits a CSV for the selected store', async () => {
    const previewFile = multipart('products.csv', Buffer.from(csv), 'text/csv')
    const preview = await ids.app.inject({
      method: 'POST',
      url: '/api/v1/products/bulk-import/preview?mode=ADD_ONLY',
      headers: {
        authorization: `Bearer ${ids.token}`,
        'x-shop-id': ids.shop,
        'content-type': `multipart/form-data; boundary=${previewFile.boundary}`,
      },
      payload: previewFile.payload,
    })
    expect(preview.statusCode).toBe(200)
    expect(preview.json().data.summary.total_rows).toBe(1)
    expect(preview.json().data.rows[0].action).toBe('CREATE_MASTER_AND_ADD')

    const commitFile = multipart('products.csv', Buffer.from(csv), 'text/csv')
    const commit = await ids.app.inject({
      method: 'POST',
      url: '/api/v1/products/bulk-import/commit?mode=ADD_ONLY',
      headers: {
        authorization: `Bearer ${ids.token}`,
        'x-shop-id': ids.shop,
        'content-type': `multipart/form-data; boundary=${commitFile.boundary}`,
      },
      payload: commitFile.payload,
    })
    expect(commit.statusCode).toBe(200)
    expect(commit.json().data.summary.created_master).toBe(1)
    expect(commit.json().data.summary.added_to_shop).toBe(1)

    const shopProduct = await query(
      `SELECT sp.stock_quantity, sp.price, p.name, p.sku
         FROM shop_products sp
         JOIN products p ON p.id = sp.product_id
        WHERE sp.shop_id = $1 AND p.sku = $2`,
      [ids.shop, `ROUTE-BULK-${suffix}`]
    )
    expect(shopProduct.rows[0]).toBeTruthy()
    expect(shopProduct.rows[0].stock_quantity).toBe(4)
    expect(Number(shopProduct.rows[0].price)).toBe(75)
  })

  it('imports the same master independently into a second store', async () => {
    const secondCsv = [
      'product_name,category,price,stock_quantity,unit,sku',
      `Route Bulk Product ${suffix},Route Bulk Category ${suffix},210,9,kg,ROUTE-BULK-${suffix}`,
    ].join('\r\n')
    const file = multipart('products.csv', Buffer.from(secondCsv), 'text/csv')

    const preview = await ids.app.inject({
      method: 'POST',
      url: '/api/v1/products/bulk-import/preview?mode=ADD_ONLY',
      headers: {
        authorization: `Bearer ${ids.token}`,
        'x-shop-id': ids.shop2,
        'content-type': `multipart/form-data; boundary=${file.boundary}`,
      },
      payload: file.payload,
    })
    expect(preview.statusCode).toBe(200)
    expect(preview.json().data.rows[0].action).toBe('ADD_TO_SHOP')

    const commitFile = multipart('products.csv', Buffer.from(secondCsv), 'text/csv')
    const commit = await ids.app.inject({
      method: 'POST',
      url: '/api/v1/products/bulk-import/commit?mode=ADD_ONLY',
      headers: {
        authorization: `Bearer ${ids.token}`,
        'x-shop-id': ids.shop2,
        'content-type': `multipart/form-data; boundary=${commitFile.boundary}`,
      },
      payload: commitFile.payload,
    })
    expect(commit.statusCode).toBe(200)
    expect(commit.json().data.summary.created_master).toBe(0)
    expect(commit.json().data.summary.added_to_shop).toBe(1)

    const listings = await query(
      `SELECT sp.shop_id, sp.stock_quantity, sp.price
         FROM shop_products sp
         JOIN products p ON p.id = sp.product_id
        WHERE p.sku = $1
        ORDER BY sp.shop_id`,
      [`ROUTE-BULK-${suffix}`]
    )
    const byShop = new Map(listings.rows.map((row) => [row.shop_id, row]))
    expect(byShop.size).toBe(2)
    expect(byShop.get(ids.shop).stock_quantity).toBe(4)
    expect(Number(byShop.get(ids.shop).price)).toBe(75)
    expect(byShop.get(ids.shop2).stock_quantity).toBe(9)
    expect(Number(byShop.get(ids.shop2).price)).toBe(210)
  })

  it('rejects a customer token from the admin import', async () => {
    const customerToken = ids.app.jwt.sign({ id: ids.user, role: 'CUSTOMER' })
    const file = multipart('products.csv', Buffer.from(csv), 'text/csv')
    const res = await ids.app.inject({
      method: 'POST',
      url: '/api/v1/products/bulk-import/preview?mode=ADD_ONLY',
      headers: {
        authorization: `Bearer ${customerToken}`,
        'x-shop-id': ids.shop,
        'content-type': `multipart/form-data; boundary=${file.boundary}`,
      },
      payload: file.payload,
    })
    expect(res.statusCode).toBe(403)
  })

  it('rejects unauthenticated template downloads', async () => {
    const res = await ids.app.inject({
      method: 'GET',
      url: '/api/v1/products/bulk-import/template?format=xlsx',
    })
    expect(res.statusCode).toBe(401)
  })
})
