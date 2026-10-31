import { beforeAll, afterAll, describe, expect, it } from 'vitest'

// Never load application configuration or fixtures outside the disposable harness.
const isolated = process.env.NODE_ENV === 'test' && process.env.DB_NAME === 'freshcuts_bulk_test' && /^\/private\/tmp\/fc-phase3-test\.[^/]+$/.test(process.env.DB_HOST ?? '')

let app, query, closePool, redis, shop, shop2, category, actor, service
const boundary = 'freshcuts-test-boundary'
const headers = 'product_name,category,price,stock_quantity,unit,sku'
const makeCsv = (name, sku) => `${headers}\n${name},Phase Three Category,100,5,kg,${sku}\n`
const payload = (csv) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="products.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--${boundary}--\r\n`)
const send = (url, token, csv, shopId = shop) => app.inject({
  method: 'POST', url,
  headers: { ...(token && { authorization: `Bearer ${token}` }), ...(shopId && { 'x-shop-id': shopId }), 'content-type': `multipart/form-data; boundary=${boundary}` },
  payload: payload(csv),
})

describe.skipIf(!isolated)('bulk import HTTP and rollback on disposable database', () => {
beforeAll(async () => {
  const db = await import('../../src/config/database.js')
  query = db.query; closePool = db.closePool
  redis = (await import('../../src/config/redis.js')).redis
  const Fastify = (await import('fastify')).default
  app = Fastify()
  await app.register(import('../../src/plugins/errorHandler.plugin.js'))
  await app.register(import('../../src/plugins/auth.plugin.js'))
  await app.register(import('../../src/plugins/multipart.plugin.js'))
  await app.register(import('../../src/modules/products/products.routes.js'), { prefix: '/api/v1/products' })
  await app.ready()
  shop = (await query(`INSERT INTO shops (name,slug,branch_code,address_line1,city,state,pincode,lat,lng,serviceable_pincodes) VALUES ('Phase Three Shop','phase-three-shop','P3TEST','Test Road','Kolkata','West Bengal','700001',22.5,88.3,ARRAY['700001']) RETURNING id`)).rows[0].id
  shop2 = (await query(`INSERT INTO shops (name,slug,branch_code,address_line1,city,state,pincode,lat,lng,serviceable_pincodes) VALUES ('Phase Three Shop Two','phase-three-shop-two','P3TEST2','Test Road','Kolkata','West Bengal','700001',22.5,88.3,ARRAY['700001']) RETURNING id`)).rows[0].id
  category = (await query(`INSERT INTO categories (name,slug) VALUES ('Phase Three Category','phase-three-category') RETURNING id`)).rows[0].id
  actor = (await query(`INSERT INTO users (phone,name) VALUES ('9000012345','Phase Three Test Admin') RETURNING id`)).rows[0].id
  const { ProductBulkImportService } = await import('../../src/modules/products/product-bulk-import.service.js')
  service = new ProductBulkImportService()
})

afterAll(async () => {
  if (app) await app.close()
  if (redis) redis.disconnect()
  if (closePool) await closePool()
})

  it('enforces authentication, admin role and a valid selected store', async () => {
    const csv = makeCsv('Auth Test', 'AUTH-TEST')
    const admin = app.jwt.sign({ id: actor, role: 'ADMIN' })
    const customer = app.jwt.sign({ id: actor, role: 'CUSTOMER' })
    expect((await send('/api/v1/products/bulk-import/preview', null, csv)).statusCode).toBe(401)
    expect((await send('/api/v1/products/bulk-import/preview', customer, csv)).statusCode).toBe(403)
    expect((await send('/api/v1/products/bulk-import/preview', admin, csv, null)).statusCode).toBe(400)
    expect((await send('/api/v1/products/bulk-import/preview', admin, csv, 'not-a-store')).statusCode).toBe(400)
  })

  it('previews without writes and commits to the selected store', async () => {
    const csv = makeCsv('Route Test Product', 'ROUTE-TEST')
    const admin = app.jwt.sign({ id: actor, role: 'ADMIN' })
    const preview = await send('/api/v1/products/bulk-import/preview', admin, csv)
    expect(preview.statusCode).toBe(200)
    expect((await query(`SELECT id FROM products WHERE sku='ROUTE-TEST'`)).rows).toHaveLength(0)
    const commit = await send('/api/v1/products/bulk-import/commit', admin, csv)
    expect(commit.statusCode).toBe(200)
    expect(commit.json().data.summary.added_to_shop).toBe(1)
    const attached = await query(`SELECT sp.shop_id, sp.stock_quantity FROM shop_products sp JOIN products p ON p.id=sp.product_id WHERE p.sku='ROUTE-TEST'`)
    expect(attached.rows).toHaveLength(1)
    expect(attached.rows[0]).toMatchObject({ shop_id: shop, stock_quantity: 5 })
  })

  it('keeps imports separate between two stores', async () => {
    const admin = app.jwt.sign({ id: actor, role: 'ADMIN' })
    const csv = makeCsv('Route Test Product', 'ROUTE-TEST')
    const commit = await send('/api/v1/products/bulk-import/commit', admin, csv, shop2)
    expect(commit.statusCode).toBe(200)
    const rows = (await query(`SELECT sp.shop_id FROM shop_products sp JOIN products p ON p.id=sp.product_id WHERE p.sku='ROUTE-TEST'`)).rows
    expect(rows.map((row) => row.shop_id).sort()).toEqual([shop, shop2].sort())
  })

  it('imports fifty rows through the HTTP endpoint', async () => {
    const admin = app.jwt.sign({ id: actor, role: 'ADMIN' })
    const rows = Array.from({ length: 50 }, (_, i) => `Batch Product ${i},Phase Three Category,100,5,kg,BATCH-${i}`)
    const csv = `${headers}\n${rows.join('\n')}\n`
    const preview = await send('/api/v1/products/bulk-import/preview', admin, csv)
    expect(preview.statusCode).toBe(200)
    expect(preview.json().data.summary.valid_rows).toBe(50)
    const commit = await send('/api/v1/products/bulk-import/commit', admin, csv)
    expect(commit.statusCode).toBe(200)
    expect(commit.json().data.summary.added_to_shop).toBe(50)
    expect((await query(`SELECT count(*)::int AS n FROM shop_products sp JOIN products p ON p.id=sp.product_id WHERE sp.shop_id=$1 AND p.sku LIKE 'BATCH-%'`, [shop])).rows[0].n).toBe(50)
  })

  it('does not overwrite a store listing created after an add-only plan', async () => {
    const product = (await query(`INSERT INTO products (name,slug,price,category_id,unit,sku,is_active) VALUES ('Concurrent Product','concurrent-product',100,$1,'kg','CONCURRENT-TEST',true) RETURNING id`, [category])).rows[0].id
    const originalPlan = service.buildPlan.bind(service)
    service.buildPlan = async (options) => {
      const plan = await originalPlan(options)
      await query(`INSERT INTO shop_products (shop_id,product_id,price,stock_quantity,is_available) VALUES ($1,$2,999,99,true)`, [shop, product])
      return plan
    }
    try {
      const result = await service.commit({ buffer: Buffer.from(makeCsv('Concurrent Product', 'CONCURRENT-TEST')), filename: 'test.csv', shopId: shop, actorId: actor })
      expect(result.summary.skipped).toBe(1)
      const listing = (await query('SELECT price,stock_quantity FROM shop_products WHERE shop_id=$1 AND product_id=$2', [shop, product])).rows[0]
      expect(Number(listing.price)).toBe(999)
      expect(listing.stock_quantity).toBe(99)
    } finally {
      service.buildPlan = originalPlan
    }
  })

  it('rolls back a newly created master if its store attachment fails', async () => {
    const original = service.repository.upsertShopProductTx.bind(service.repository)
    service.repository.upsertShopProductTx = async (client, shopId, productId, data) => {
      const name = await client.query('SELECT sku FROM products WHERE id=$1', [productId])
      if (name.rows[0].sku === 'ROLLBACK-TEST') throw new Error('simulated store attachment failure')
      return original(client, shopId, productId, data)
    }
    const csv = `${headers}\nRollback Product,Phase Three Category,100,5,kg,ROLLBACK-TEST\nOther Product,Phase Three Category,100,5,kg,OTHER-TEST\n`
    const result = await service.commit({ buffer: Buffer.from(csv), filename: 'test.csv', shopId: shop, actorId: actor })
    expect(result.summary.failed).toBe(1)
    expect(result.summary.added_to_shop).toBe(1)
    expect((await query(`SELECT id FROM products WHERE sku='ROLLBACK-TEST'`)).rows).toHaveLength(0)
    expect((await query(`SELECT id FROM products WHERE sku='OTHER-TEST'`)).rows).toHaveLength(1)
  })
})
