import { getClient } from '../../config/database.js'
import { cacheDeletePattern } from '../../utils/cache.js'
import { emitInTx } from '../../utils/audit-log.js'
import { logger } from '../../config/logger.js'
import { generateSlug } from '../../utils/slugify.js'
import { ProductsRepository } from './products.repository.js'
import { ProductBulkImportRepository } from './product-bulk-import.repository.js'
import {
  bulkImportError,
  parseBoolean,
  parseBulkImportFile,
  parseList,
  parseNumber,
} from './product-bulk-import.parser.js'

const MASTER_UNITS = new Set(['kg', 'g', 'l', 'ml', 'piece', 'pack', 'dozen', 'box'])
const FOOD_TYPES = new Set(['VEG', 'NON_VEG', 'EGG', 'NONE'])
const SKIN_TYPES = new Set(['SKIN_ON', 'SKINLESS', 'NONE'])
const MODES = new Set(['ADD_ONLY', 'UPDATE_EXISTING'])
const SHOP_PRODUCT_CACHE_PREFIX = 'bakaloo:shop-products:v1'

const ACTIONS = {
  CREATE_MASTER_AND_ADD: 'CREATE_MASTER_AND_ADD',
  ADD_TO_SHOP: 'ADD_TO_SHOP',
  UPDATE_SHOP: 'UPDATE_SHOP',
  SKIP_EXISTING: 'SKIP_EXISTING',
  ERROR: 'ERROR',
}

function pushError(row, message) {
  row.errors.push(message)
}

function validateText(row, field, value, { required = false, max = null, label = field } = {}) {
  const text = String(value ?? '').trim()
  if (required && !text) {
    pushError(row, `${label} is required`)
    return ''
  }
  if (max && text.length > max) pushError(row, `${label} must be ${max} characters or fewer`)
  return text
}

function validateNumber(row, value, { required = false, integer = false, min = null, max = null, label = 'value' } = {}) {
  const parsed = parseNumber(value)
  if (parsed === null) {
    if (required) pushError(row, `${label} is required`)
    return null
  }
  if (Number.isNaN(parsed)) {
    pushError(row, `${label} must be a number`)
    return null
  }
  if (integer && !Number.isInteger(parsed)) pushError(row, `${label} must be a whole number`)
  if (min !== null && parsed < min) pushError(row, `${label} must be at least ${min}`)
  if (max !== null && parsed > max) pushError(row, `${label} must be at most ${max}`)
  return parsed
}

function validateBoolean(row, value, label, defaultValue = null) {
  const parsed = parseBoolean(value)
  if (parsed === undefined) {
    pushError(row, `${label} must be true or false`)
    return defaultValue
  }
  return parsed ?? defaultValue
}

function validateOptions(row, value, label) {
  const options = parseList(value)
  if (options.some((option) => option.length > 50)) {
    pushError(row, `${label} entries must be 50 characters or fewer`)
  }
  return options
}

function validateImages(row, value) {
  const urls = parseList(value)
  if (urls.length > 8) pushError(row, 'image_urls supports at most 8 images')
  for (const url of urls) {
    if (url.length > 512) {
      pushError(row, 'Each image URL must be 512 characters or fewer')
      continue
    }
    try {
      const parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('bad protocol')
    } catch {
      pushError(row, `Invalid image URL: ${url}`)
    }
  }
  return urls
}

function normalizeRow(rawRow) {
  const values = rawRow.values
  const row = {
    row: rawRow.row,
    errors: [],
    warnings: [],
    product_name: '',
    sku: '',
    raw_category: String(values.category ?? '').trim(),
    category: null,
    price: null,
    sale_price: null,
    cost_price: null,
    wholesale_price: null,
    stock_quantity: null,
    unit: '',
    low_stock_threshold: 5,
    max_order_qty: 50,
    is_available: null,
    is_featured: false,
    food_type: 'NONE',
    skin_type: 'NONE',
    cut_options: [],
    piece_options: [],
    image_urls: [],
    description: '',
    brand: '',
    shelf_life: '',
    storage_instructions: '',
    net_quantity: '',
    cut_type: '',
    master: null,
    is_new_master: false,
    existing_shop_product: null,
    action: ACTIONS.ERROR,
  }

  row.product_name = validateText(row, 'product_name', values.product_name, {
    required: true,
    max: 200,
    label: 'product_name',
  })
  row.sku = validateText(row, 'sku', values.sku, { max: 100, label: 'sku' })
  row.unit = validateText(row, 'unit', values.unit, { required: true, label: 'unit' }).toLowerCase()
  if (row.unit && !MASTER_UNITS.has(row.unit)) {
    pushError(row, `unit must be one of: ${[...MASTER_UNITS].join(', ')}`)
  }

  row.description = validateText(row, 'description', values.description, {
    max: 10000,
    label: 'description',
  })
  row.brand = validateText(row, 'brand', values.brand, { max: 200, label: 'brand' })
  row.shelf_life = validateText(row, 'shelf_life', values.shelf_life, {
    max: 200,
    label: 'shelf_life',
  })
  row.storage_instructions = validateText(row, 'storage_instructions', values.storage_instructions, {
    max: 500,
    label: 'storage_instructions',
  })
  row.net_quantity = validateText(row, 'net_quantity', values.net_quantity, {
    max: 200,
    label: 'net_quantity',
  })
  row.cut_type = validateText(row, 'cut_type', values.cut_type, {
    max: 50,
    label: 'cut_type',
  })

  row.price = validateNumber(row, values.price, {
    required: true,
    min: 0.01,
    max: 99999999.99,
    label: 'price',
  })
  row.sale_price = validateNumber(row, values.sale_price, {
    min: 0.01,
    max: 99999999.99,
    label: 'sale_price',
  })
  row.cost_price = validateNumber(row, values.cost_price, {
    min: 0,
    max: 99999999.99,
    label: 'cost_price',
  })
  row.wholesale_price = validateNumber(row, values.wholesale_price, {
    min: 0.01,
    max: 99999999.99,
    label: 'wholesale_price',
  })
  row.stock_quantity = validateNumber(row, values.stock_quantity, {
    required: true,
    integer: true,
    min: 0,
    max: 2147483647,
    label: 'stock_quantity',
  })
  row.low_stock_threshold = validateNumber(row, values.low_stock_threshold, {
    integer: true,
    min: 0,
    max: 1000000,
    label: 'low_stock_threshold',
  })
  row.max_order_qty = validateNumber(row, values.max_order_qty, {
    integer: true,
    min: 1,
    max: 10000,
    label: 'max_order_qty',
  })

  if (row.price !== null && row.sale_price !== null && row.sale_price >= row.price) {
    pushError(row, 'sale_price must be less than price')
  }

  row.is_available = validateBoolean(row, values.is_available, 'is_available', null)
  row.is_featured = validateBoolean(row, values.is_featured, 'is_featured', null)

  row.food_type = validateText(row, 'food_type', values.food_type, {
    max: 20,
    label: 'food_type',
  }).toUpperCase() || 'NONE'
  if (!FOOD_TYPES.has(row.food_type)) {
    pushError(row, `food_type must be one of: ${[...FOOD_TYPES].join(', ')}`)
  }

  row.skin_type = validateText(row, 'skin_type', values.skin_type, {
    max: 20,
    label: 'skin_type',
  }).toUpperCase() || 'NONE'
  if (!SKIN_TYPES.has(row.skin_type)) {
    pushError(row, `skin_type must be one of: ${[...SKIN_TYPES].join(', ')}`)
  }

  row.cut_options = validateOptions(row, values.cut_options, 'cut_options')
  row.piece_options = validateOptions(row, values.piece_options, 'piece_options')
  row.image_urls = validateImages(row, values.image_urls)

  if (row.stock_quantity === 0 && row.is_available === true) {
    row.warnings.push('Stock is 0, so the store listing will be unavailable')
  }

  return row
}

export class ProductBulkImportService {
  constructor(
    repository = new ProductBulkImportRepository(),
    productsRepository = new ProductsRepository()
  ) {
    this.repository = repository
    this.productsRepository = productsRepository
  }

  async buildPlan({ buffer, filename, mimetype, shopId, mode = 'ADD_ONLY', defaultCategoryId = null } = {}) {
    if (!shopId) {
      throw bulkImportError(
        'Select a store before importing',
        400,
        'SHOP_SCOPE_REQUIRED'
      )
    }
    if (!MODES.has(mode)) {
      throw bulkImportError('mode must be ADD_ONLY or UPDATE_EXISTING', 422, 'BULK_IMPORT_INVALID_MODE')
    }

    const parsed = await parseBulkImportFile({ buffer, filename, mimetype })
    const categories = await this.repository.listCategories()

    const categoryById = new Map(categories.map((category) => [category.id, category]))
    const categoryBySlug = new Map(categories.map((category) => [category.slug.toLowerCase(), category]))
    const categoryByName = new Map()
    for (const category of categories) {
      const key = category.name.trim().toLowerCase()
      const list = categoryByName.get(key) ?? []
      list.push(category)
      categoryByName.set(key, list)
    }

    let defaultCategory = null
    if (defaultCategoryId) {
      defaultCategory = categoryById.get(defaultCategoryId) ?? null
      if (!defaultCategory) {
        throw bulkImportError(
          'The selected default category does not exist or is inactive',
          422,
          'DEFAULT_CATEGORY_INVALID'
        )
      }
    }

    const rows = parsed.rows.map(normalizeRow)
    const skuSeen = new Map()
    const nameCategorySeen = new Map()

    for (const row of rows) {
      const rawCategory = row.raw_category
      if (!rawCategory) {
        if (defaultCategory) {
          row.category = defaultCategory
        } else {
          pushError(row, 'category is required (or choose a default category before importing)')
        }
      } else {
        const lookup = rawCategory.toLowerCase()
        const slugMatch = categoryBySlug.get(lookup)
        const nameMatches = categoryByName.get(lookup) ?? []
        if (slugMatch) {
          row.category = slugMatch
        } else if (nameMatches.length === 1) {
          row.category = nameMatches[0]
        } else if (nameMatches.length > 1) {
          pushError(row, `Multiple categories match "${rawCategory}"; use the category slug`)
        } else {
          pushError(row, `Category "${rawCategory}" does not exist`)
        }
      }

      if (row.sku) {
        const key = row.sku.toLowerCase()
        if (skuSeen.has(key)) {
          pushError(row, `Duplicate sku in file (also row ${skuSeen.get(key)})`)
        } else {
          skuSeen.set(key, row.row)
        }
      }

      if (row.product_name && row.category) {
        const key = `${row.product_name.toLowerCase()}|${row.category.id}`
        if (nameCategorySeen.has(key)) {
          pushError(row, `Duplicate product_name + category in file (also row ${nameCategorySeen.get(key)})`)
        } else {
          nameCategorySeen.set(key, row.row)
        }
      }
    }

    const skus = [...new Set(rows.map((row) => row.sku.toLowerCase()).filter(Boolean))]
    const names = [...new Set(rows.map((row) => row.product_name.toLowerCase()).filter(Boolean))]
    const masters = await this.repository.findMastersForRows({ skus, names })

    const masterBySku = new Map()
    const masterByNameCategory = new Map()
    for (const master of masters) {
      if (master.sku) {
        const key = master.sku.toLowerCase()
        const list = masterBySku.get(key) ?? []
        list.push(master)
        masterBySku.set(key, list)
      }
      const key = `${master.name.trim().toLowerCase()}|${master.category_id ?? ''}`
      const list = masterByNameCategory.get(key) ?? []
      list.push(master)
      masterByNameCategory.set(key, list)
    }

    for (const row of rows) {
      if (row.errors.length > 0) continue
      if (row.sku) {
        const matches = masterBySku.get(row.sku.toLowerCase()) ?? []
        if (matches.length > 1) {
          pushError(row, 'Multiple master products share this sku; resolve the duplicate first')
        } else if (matches.length === 1) {
          row.master = matches[0]
        }
      }

      if (!row.master) {
        const key = `${row.product_name.toLowerCase()}|${row.category.id}`
        const matches = masterByNameCategory.get(key) ?? []
        if (matches.length > 1) {
          pushError(row, 'Multiple master products share this name and category; add a sku')
        } else if (matches.length === 1) {
          row.master = matches[0]
          if (
            row.sku &&
            row.master.sku &&
            row.master.sku.toLowerCase() !== row.sku.toLowerCase()
          ) {
            row.warnings.push(
              `Matched by name + category; the master product sku is "${row.master.sku}"`
            )
          }
        }
      }

      if (row.master) {
        if (row.master.deleted_at) {
          pushError(row, 'The matching master product is deleted; restore it before importing')
        } else if (!row.master.is_active) {
          pushError(row, 'The matching master product is inactive; activate it before importing')
        }
        if (row.sku && row.master.sku && row.master.name.trim().toLowerCase() !== row.product_name.toLowerCase()) {
          row.warnings.push(`Matched by sku; the master product is named "${row.master.name}"`)
        }
        if (row.master.unit && row.master.unit.toLowerCase() !== row.unit) {
          row.warnings.push(`The master product unit is "${row.master.unit}"; the sheet unit is ignored`)
        }
      } else if (!row.errors.length) {
        row.is_new_master = true
      }
    }

    const masterIdSeen = new Map()
    for (const row of rows) {
      if (row.errors.length > 0 || !row.master) continue
      if (masterIdSeen.has(row.master.id)) {
        pushError(row, `Duplicate product in file (also row ${masterIdSeen.get(row.master.id)})`)
      } else {
        masterIdSeen.set(row.master.id, row.row)
      }
    }

    const masterIds = [...new Set(rows.map((row) => row.master?.id).filter(Boolean))]
    const shopProducts = await this.repository.findShopProducts(shopId, masterIds)
    const shopProductByProductId = new Map(shopProducts.map((product) => [product.product_id, product]))

    for (const row of rows) {
      if (row.errors.length > 0) {
        row.action = ACTIONS.ERROR
        continue
      }
      if (row.is_new_master) {
        row.action = ACTIONS.CREATE_MASTER_AND_ADD
        continue
      }

      const existing = shopProductByProductId.get(row.master.id) ?? null
      if (existing && !existing.deleted_at) {
        if (mode === 'ADD_ONLY') {
          row.action = ACTIONS.SKIP_EXISTING
          row.warnings.push('Already listed in this store; skipped in ADD_ONLY mode')
        } else {
          row.action = ACTIONS.UPDATE_SHOP
          row.existing_shop_product = existing
        }
      } else {
        row.action = ACTIONS.ADD_TO_SHOP
        if (existing?.deleted_at) {
          row.warnings.push('This store listing was removed earlier and will be revived')
        }
      }
    }

    const summary = {
      total_rows: rows.length,
      valid_rows: rows.filter((row) => row.errors.length === 0).length,
      error_rows: rows.filter((row) => row.errors.length > 0).length,
      create_master: rows.filter((row) => row.action === ACTIONS.CREATE_MASTER_AND_ADD).length,
      add_to_shop: rows.filter((row) => row.action === ACTIONS.ADD_TO_SHOP).length,
      update_shop: rows.filter((row) => row.action === ACTIONS.UPDATE_SHOP).length,
      skip_existing: rows.filter((row) => row.action === ACTIONS.SKIP_EXISTING).length,
    }

    return {
      shopId,
      mode,
      headers: parsed.headers,
      rows,
      summary,
    }
  }

  publicPreview(plan) {
    return {
      shop_id: plan.shopId,
      mode: plan.mode,
      headers: plan.headers,
      summary: plan.summary,
      rows: plan.rows.map((row) => ({
        row: row.row,
        product_name: row.product_name,
        sku: row.sku || null,
        category_name: row.category?.name ?? null,
        price: row.price,
        stock_quantity: row.stock_quantity,
        unit: row.unit,
        action: row.action,
        master_product_id: row.master?.id ?? null,
        shop_product_id: row.existing_shop_product?.id ?? null,
        warnings: row.warnings,
        errors: row.errors,
      })),
    }
  }

  async preview(options) {
    const plan = await this.buildPlan(options)
    return this.publicPreview(plan)
  }

  buildMasterPayload(row) {
    return {
      name: row.product_name,
      slug: generateSlug(row.product_name),
      description: row.description || null,
      price: row.price,
      salePrice: row.sale_price ?? undefined,
      costPrice: row.cost_price ?? undefined,
      wholesalePrice: row.wholesale_price ?? null,
      categoryId: row.category.id,
      stock: 0,
      unit: row.unit,
      thumbnailUrl: row.image_urls[0] ?? null,
      images: row.image_urls,
      isFeatured: false,
      isActive: true,
      sku: row.sku || null,
      lowStockThreshold: 10,
      foodType: row.food_type,
      originTag: 'NONE',
      cutOptions: row.cut_options,
      pieceOptions: row.piece_options,
      cutType: row.cut_type || null,
      skinType: row.skin_type,
      brand: row.brand || null,
      shelfLife: row.shelf_life || null,
      storageInstructions: row.storage_instructions || null,
      netQuantity: row.net_quantity || null,
      returnPolicy: 'no_return',
    }
  }

  buildShopPayload(row) {
    const existing = row.existing_shop_product
    const isAvailable =
      row.stock_quantity > 0
        ? (row.is_available ?? existing?.is_available ?? true)
        : false

    return {
      price: row.price,
      sale_price: row.sale_price ?? existing?.sale_price ?? null,
      cost_price: row.cost_price ?? existing?.cost_price ?? null,
      wholesale_price: row.wholesale_price ?? existing?.wholesale_price ?? null,
      stock_quantity: row.stock_quantity,
      low_stock_threshold: row.low_stock_threshold ?? existing?.low_stock_threshold ?? 5,
      max_order_qty: row.max_order_qty ?? existing?.max_order_qty ?? 50,
      is_available: isAvailable,
      is_featured: row.is_featured ?? existing?.is_featured ?? false,
    }
  }

  async commit(options) {
    const plan = await this.buildPlan(options)
    const summary = {
      total_rows: plan.summary.total_rows,
      created_master: 0,
      added_to_shop: 0,
      updated_shop: 0,
      skipped: 0,
      failed: 0,
    }
    const errors = []

    const client = await getClient()
    try {
      await client.query('BEGIN')

      for (const row of plan.rows) {
        if (row.errors.length > 0) {
          summary.failed += 1
          errors.push({
            row: row.row,
            product_name: row.product_name,
            sku: row.sku || null,
            message: row.errors.join('; '),
          })
          continue
        }
        if (row.action === ACTIONS.SKIP_EXISTING) {
          summary.skipped += 1
          continue
        }

        const savepoint = `bulk_import_row_${row.row}`
        await client.query(`SAVEPOINT ${savepoint}`)
        try {
          let productId = row.master?.id ?? null
          let createdMaster = false
          if (row.action === ACTIONS.CREATE_MASTER_AND_ADD) {
            const master = await this.productsRepository.create(
              this.buildMasterPayload(row),
              client
            )
            productId = master.id
            createdMaster = true
          }

          const listing = await this.repository.upsertShopProductTx(
            client,
            plan.shopId,
            productId,
            this.buildShopPayload(row),
            plan.mode === 'ADD_ONLY'
          )

          // A listing may have appeared since buildPlan. In add-only mode it
          // must win over this import, including its price and stock.
          if (!listing) {
            await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
            await client.query(`RELEASE SAVEPOINT ${savepoint}`)
            summary.skipped += 1
            continue
          }

          if (createdMaster) summary.created_master += 1
          if (row.action === ACTIONS.CREATE_MASTER_AND_ADD || row.action === ACTIONS.ADD_TO_SHOP) {
            summary.added_to_shop += 1
          } else {
            summary.updated_shop += 1
          }
          await client.query(`RELEASE SAVEPOINT ${savepoint}`)
        } catch (err) {
          await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
          summary.failed += 1
          errors.push({
            row: row.row,
            product_name: row.product_name,
            sku: row.sku || null,
            message: err.message,
          })
          logger.warn(
            { err, row: row.row, shopId: plan.shopId },
            'Bulk import row failed; savepoint rolled back'
          )
        }
      }

      await emitInTx(client, 'products.bulk_import.committed', {
        actor_user_id: options.actorId ?? null,
        target_type: 'shop',
        target_id: plan.shopId,
        after: { ...summary, error_count: errors.length },
      })
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    try {
      await Promise.all([
        cacheDeletePattern(`${SHOP_PRODUCT_CACHE_PREFIX}:${plan.shopId}:*`),
        cacheDeletePattern('products:*'),
        cacheDeletePattern('bakaloo:tab_home:*'),
        cacheDeletePattern('bakaloo:sections:public:*'),
      ])
    } catch (err) {
      logger.error({ err, shopId: plan.shopId }, 'Bulk import cache invalidation failed')
    }

    return { summary, errors }
  }
}
