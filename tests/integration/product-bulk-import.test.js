/**
 * Product bulk import against real PostgreSQL.
 *
 * Covers the Phase 3 contract:
 *   CSV/XLSX parse -> preview (no writes) -> commit -> master auto-create,
 *   store attach, skip/update modes, default category, row errors, templates.
 *
 * SKIPS itself when no database is reachable. Fixtures deleted in afterAll.
 * Run only against an isolated test database.
 */

import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { config } from 'dotenv'
import pg from 'pg'
import ExcelJS from 'exceljs'

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

import { ProductBulkImportService } from '../../src/modules/products/product-bulk-import.service.js'
import { buildCsvTemplate, buildXlsxTemplate } from '../../src/modules/products/product-bulk-import.template.js'
import { query, closePool } from '../../src/config/database.js'

const suffix = Math.random().toString(36).slice(2, 10)
const ids = {}

const CSV_HEADERS = [
  'product_name',
  'category',
  'price',
  'stock_quantity',
  'unit',
  'sku',
  'sale_price',
  'low_stock_threshold',
  'max_order_qty',
  'is_available',
  'is_featured',
  'food_type',
  'image_urls',
]

function escapeCsv(value) {
  const text = String(value ?? '')
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function csvBuffer(rows, headers = CSV_HEADERS) {
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escapeCsv(row[header] ?? '')).join(',')),
  ]
  return Buffer.from(lines.join('\r\n'), 'utf8')
}

async function xlsxBuffer(rows, headers = CSV_HEADERS) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Products')
  sheet.addRow(headers)
  rows.forEach((row) => sheet.addRow(headers.map((header) => row[header] ?? '')))
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

beforeAll(async () => {
  if (!dbUp) return

  const shop = await query(
    `INSERT INTO shops (name, slug, branch_code, address_line1, city, state, pincode, lat, lng, serviceable_pincodes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [
      `Bulk Import Store ${suffix}`,
      `bulk-import-store-${suffix}`,
      `BI${suffix.slice(0, 6)}`,
      '1 Bulk Import Road',
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
    [`Bulk Category ${suffix}`, `bulk-category-${suffix}`]
  )
  ids.category = category.rows[0].id

  const existing = await query(
    `INSERT INTO products (name, slug, price, category_id, unit, sku, is_active)
     VALUES ($1, $2, 300, $3, 'kg', $4, true) RETURNING id`,
    [`Bulk Existing ${suffix}`, `bulk-existing-${suffix}`, ids.category, `BULK-EXIST-${suffix}`]
  )
  ids.existingProduct = existing.rows[0].id

  const existingShop = await query(
    `INSERT INTO products (name, slug, price, category_id, unit, sku, is_active)
     VALUES ($1, $2, 400, $3, 'kg', $4, true) RETURNING id`,
    [`Bulk Existing Shop ${suffix}`, `bulk-existing-shop-${suffix}`, ids.category, `BULK-SHOP-${suffix}`]
  )
  ids.existingShopProduct = existingShop.rows[0].id

  const shopProduct = await query(
    `INSERT INTO shop_products
       (shop_id, product_id, price, stock_quantity, low_stock_threshold, max_order_qty, is_available, is_featured)
     VALUES ($1, $2, 999, 5, 2, 25, true, true) RETURNING id`,
    [ids.shop, ids.existingShopProduct]
  )
  ids.shopProduct = shopProduct.rows[0].id
})

afterAll(async () => {
  if (!dbUp) return
  if (ids.shop) await query(`DELETE FROM shop_products WHERE shop_id = $1`, [ids.shop])
  if (ids.category) await query(`DELETE FROM products WHERE category_id = $1`, [ids.category])
  if (ids.category) await query(`DELETE FROM categories WHERE id = $1`, [ids.category])
  if (ids.shop) await query(`DELETE FROM shops WHERE id = $1`, [ids.shop])
  await closePool()
})

const NEW_NAME = `Bulk New ${suffix}`
const NEW_SKU = `BULK-NEW-${suffix}`
const INVALID_NAME = `Bulk Invalid ${suffix}`

describe.skipIf(!dbUp)('product bulk import', () => {
  const service = new ProductBulkImportService()

  it('previews a CSV without writing anything', async () => {
    const buffer = csvBuffer([
      {
        product_name: NEW_NAME,
        category: `Bulk Category ${suffix}`,
        price: 100,
        stock_quantity: 10,
        unit: 'kg',
        sku: NEW_SKU,
        image_urls: 'https://example.com/bulk-new.jpg',
        food_type: 'NON_VEG',
      },
      {
        product_name: `Bulk Existing ${suffix}`,
        category: `Bulk Category ${suffix}`,
        price: 150,
        stock_quantity: 3,
        unit: 'kg',
        sku: `BULK-EXIST-${suffix}`,
      },
      {
        product_name: `Bulk Existing Shop ${suffix}`,
        category: `Bulk Category ${suffix}`,
        price: 170,
        stock_quantity: 4,
        unit: 'kg',
        sku: `BULK-SHOP-${suffix}`,
      },
      {
        product_name: INVALID_NAME,
        category: `Missing Category ${suffix}`,
        price: 50,
        stock_quantity: 1,
        unit: 'kg',
      },
    ])

    const beforeProducts = await query(`SELECT count(*)::int AS count FROM products WHERE category_id = $1`, [ids.category])
    const beforeShop = await query(`SELECT count(*)::int AS count FROM shop_products WHERE shop_id = $1`, [ids.shop])

    const preview = await service.preview({
      buffer,
      filename: 'products.csv',
      mimetype: 'text/csv',
      shopId: ids.shop,
      mode: 'ADD_ONLY',
    })

    expect(preview.summary.total_rows).toBe(4)
    expect(preview.summary.error_rows).toBe(1)
    expect(preview.summary.create_master).toBe(1)
    expect(preview.summary.add_to_shop).toBe(1)
    expect(preview.summary.skip_existing).toBe(1)

    const byName = new Map(preview.rows.map((row) => [row.product_name, row]))
    expect(byName.get(NEW_NAME).action).toBe('CREATE_MASTER_AND_ADD')
    expect(byName.get(`Bulk Existing ${suffix}`).action).toBe('ADD_TO_SHOP')
    expect(byName.get(`Bulk Existing Shop ${suffix}`).action).toBe('SKIP_EXISTING')
    expect(byName.get(INVALID_NAME).action).toBe('ERROR')
    expect(byName.get(INVALID_NAME).errors.join(' ')).toMatch(/Category .* does not exist/)

    const afterProducts = await query(`SELECT count(*)::int AS count FROM products WHERE category_id = $1`, [ids.category])
    const afterShop = await query(`SELECT count(*)::int AS count FROM shop_products WHERE shop_id = $1`, [ids.shop])
    expect(afterProducts.rows[0].count).toBe(beforeProducts.rows[0].count)
    expect(afterShop.rows[0].count).toBe(beforeShop.rows[0].count)
  })

  it('commits valid rows, auto-creates a master and attaches it to the store', async () => {
    const buffer = csvBuffer([
      {
        product_name: NEW_NAME,
        category: `Bulk Category ${suffix}`,
        price: 100,
        stock_quantity: 10,
        unit: 'kg',
        sku: NEW_SKU,
        image_urls: 'https://example.com/bulk-new.jpg',
        food_type: 'NON_VEG',
      },
      {
        product_name: `Bulk Existing ${suffix}`,
        category: `Bulk Category ${suffix}`,
        price: 150,
        stock_quantity: 3,
        unit: 'kg',
        sku: `BULK-EXIST-${suffix}`,
      },
      {
        product_name: `Bulk Existing Shop ${suffix}`,
        category: `Bulk Category ${suffix}`,
        price: 170,
        stock_quantity: 4,
        unit: 'kg',
        sku: `BULK-SHOP-${suffix}`,
      },
      {
        product_name: INVALID_NAME,
        category: `Missing Category ${suffix}`,
        price: 50,
        stock_quantity: 1,
        unit: 'kg',
      },
    ])

    const result = await service.commit({
      buffer,
      filename: 'products.csv',
      mimetype: 'text/csv',
      shopId: ids.shop,
      mode: 'ADD_ONLY',
      actorId: null,
    })

    expect(result.summary.created_master).toBe(1)
    expect(result.summary.added_to_shop).toBe(2)
    expect(result.summary.skipped).toBe(1)
    expect(result.summary.failed).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].product_name).toBe(INVALID_NAME)

    const master = await query(
      `SELECT * FROM products WHERE name = $1 AND category_id = $2 LIMIT 1`,
      [NEW_NAME, ids.category]
    )
    expect(master.rows[0]).toBeTruthy()
    expect(master.rows[0].stock_quantity).toBe(0)
    expect(master.rows[0].sku).toBe(NEW_SKU)
    expect(Number(master.rows[0].price)).toBe(100)
    expect(master.rows[0].food_type).toBe('NON_VEG')

    const newShopProduct = await query(
      `SELECT * FROM shop_products WHERE shop_id = $1 AND product_id = $2`,
      [ids.shop, master.rows[0].id]
    )
    expect(newShopProduct.rows[0]).toBeTruthy()
    expect(newShopProduct.rows[0].stock_quantity).toBe(10)
    expect(Number(newShopProduct.rows[0].price)).toBe(100)
    expect(newShopProduct.rows[0].is_available).toBe(true)

    const existingShopProduct = await query(
      `SELECT * FROM shop_products WHERE shop_id = $1 AND product_id = $2`,
      [ids.shop, ids.existingProduct]
    )
    expect(existingShopProduct.rows[0].stock_quantity).toBe(3)
    expect(Number(existingShopProduct.rows[0].price)).toBe(150)

    const untouched = await query(`SELECT * FROM shop_products WHERE id = $1`, [ids.shopProduct])
    expect(untouched.rows[0].stock_quantity).toBe(5)
    expect(Number(untouched.rows[0].price)).toBe(999)
    expect(untouched.rows[0].is_featured).toBe(true)

    const invalid = await query(
      `SELECT id FROM products WHERE name = $1 AND category_id = $2`,
      [INVALID_NAME, ids.category]
    )
    expect(invalid.rows).toHaveLength(0)
  })

  it('updates an existing store product and preserves omitted fields', async () => {
    const buffer = csvBuffer([
      {
        product_name: `Bulk Existing Shop ${suffix}`,
        category: `Bulk Category ${suffix}`,
        price: 888,
        sale_price: 800,
        stock_quantity: 7,
        unit: 'kg',
        sku: `BULK-SHOP-${suffix}`,
      },
    ])

    const preview = await service.preview({
      buffer,
      filename: 'update.csv',
      mimetype: 'text/csv',
      shopId: ids.shop,
      mode: 'UPDATE_EXISTING',
    })
    expect(preview.rows[0].action).toBe('UPDATE_SHOP')

    const result = await service.commit({
      buffer,
      filename: 'update.csv',
      mimetype: 'text/csv',
      shopId: ids.shop,
      mode: 'UPDATE_EXISTING',
      actorId: null,
    })
    expect(result.summary.updated_shop).toBe(1)

    const updated = await query(`SELECT * FROM shop_products WHERE id = $1`, [ids.shopProduct])
    expect(Number(updated.rows[0].price)).toBe(888)
    expect(Number(updated.rows[0].sale_price)).toBe(800)
    expect(updated.rows[0].stock_quantity).toBe(7)
    expect(updated.rows[0].low_stock_threshold).toBe(2)
    expect(updated.rows[0].max_order_qty).toBe(25)
    expect(updated.rows[0].is_featured).toBe(true)
    expect(updated.rows[0].is_available).toBe(true)
  })

  it('uses a default category for blank category cells', async () => {
    const buffer = csvBuffer([
      {
        product_name: `Bulk Default Category ${suffix}`,
        category: '',
        price: 60,
        stock_quantity: 2,
        unit: 'kg',
      },
    ])

    const withoutDefault = await service.preview({
      buffer,
      filename: 'default.csv',
      mimetype: 'text/csv',
      shopId: ids.shop,
      mode: 'ADD_ONLY',
    })
    expect(withoutDefault.summary.error_rows).toBe(1)

    const withDefault = await service.preview({
      buffer,
      filename: 'default.csv',
      mimetype: 'text/csv',
      shopId: ids.shop,
      mode: 'ADD_ONLY',
      defaultCategoryId: ids.category,
    })
    expect(withDefault.summary.error_rows).toBe(0)
    expect(withDefault.rows[0].category_name).toBe(`Bulk Category ${suffix}`)
    expect(withDefault.rows[0].action).toBe('CREATE_MASTER_AND_ADD')
  })

  it('reports duplicate sku rows', async () => {
    const buffer = csvBuffer([
      {
        product_name: `Bulk Duplicate A ${suffix}`,
        category: `Bulk Category ${suffix}`,
        price: 10,
        stock_quantity: 1,
        unit: 'kg',
        sku: `BULK-DUP-${suffix}`,
      },
      {
        product_name: `Bulk Duplicate B ${suffix}`,
        category: `Bulk Category ${suffix}`,
        price: 10,
        stock_quantity: 1,
        unit: 'kg',
        sku: `BULK-DUP-${suffix}`,
      },
    ])

    const preview = await service.preview({
      buffer,
      filename: 'duplicates.csv',
      mimetype: 'text/csv',
      shopId: ids.shop,
      mode: 'ADD_ONLY',
    })
    expect(preview.summary.error_rows).toBe(1)
    expect(preview.rows[1].errors.join(' ')).toMatch(/Duplicate sku/)
  })

  it('parses XLSX and the downloadable templates', async () => {
    const buffer = await xlsxBuffer([
      {
        product_name: `Bulk XLSX ${suffix}`,
        category: `Bulk Category ${suffix}`,
        price: 70,
        stock_quantity: 2,
        unit: 'kg',
      },
    ])

    const preview = await service.preview({
      buffer,
      filename: 'products.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      shopId: ids.shop,
      mode: 'ADD_ONLY',
    })
    expect(preview.rows[0].product_name).toBe(`Bulk XLSX ${suffix}`)
    expect(preview.rows[0].action).toBe('CREATE_MASTER_AND_ADD')

    const xlsxTemplate = await buildXlsxTemplate()
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(xlsxTemplate)
    expect(workbook.worksheets[0].getRow(1).getCell(1).value).toBe('product_name')

    const csvTemplate = buildCsvTemplate().toString('utf8')
    expect(csvTemplate.startsWith('product_name,category,price,stock_quantity,unit')).toBe(true)
  })

  it('rejects missing headers and unsupported file types', async () => {
    const missingHeaders = Buffer.from('product_name,category,price,stock_quantity\nA,B,1,2\n')
    await expect(
      service.preview({
        buffer: missingHeaders,
        filename: 'missing.csv',
        mimetype: 'text/csv',
        shopId: ids.shop,
      })
    ).rejects.toMatchObject({ code: 'BULK_IMPORT_MISSING_HEADERS' })

    await expect(
      service.preview({
        buffer: Buffer.from('not a spreadsheet'),
        filename: 'products.xls',
        mimetype: 'application/vnd.ms-excel',
        shopId: ids.shop,
      })
    ).rejects.toMatchObject({ code: 'BULK_IMPORT_UNSUPPORTED_FILE' })
  })
})
