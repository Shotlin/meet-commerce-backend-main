import { query } from '../../config/database.js'

/**
 * Narrow data-access helpers for the product bulk-import flow. Writes accept a
 * transaction client so a batch can use one transaction with per-row
 * savepoints; reads use the shared pool.
 */
export class ProductBulkImportRepository {
  async listCategories() {
    const { rows } = await query(
      `SELECT id, name, slug
         FROM categories
        WHERE is_active = true AND deleted_at IS NULL
        ORDER BY name`
    )
    return rows
  }

  async findMastersForRows({ skus = [], names = [] }) {
    const conditions = []
    const params = []
    if (skus.length > 0) {
      params.push(skus)
      conditions.push(`lower(p.sku) = ANY($${params.length}::text[])`)
    }
    if (names.length > 0) {
      params.push(names)
      conditions.push(`lower(p.name) = ANY($${params.length}::text[])`)
    }
    if (conditions.length === 0) return []

    const { rows } = await query(
      `SELECT p.id, p.name, p.sku, p.unit, p.category_id, p.is_active, p.deleted_at
         FROM products p
        WHERE ${conditions.join(' OR ')}`,
      params
    )
    return rows
  }

  async findShopProducts(shopId, productIds = []) {
    if (productIds.length === 0) return []
    const { rows } = await query(
      `SELECT id, product_id, price, sale_price, cost_price, wholesale_price,
              stock_quantity, low_stock_threshold, max_order_qty,
              is_available, is_featured, deleted_at
         FROM shop_products
        WHERE shop_id = $1 AND product_id = ANY($2::uuid[])`,
      [shopId, productIds]
    )
    return rows
  }

  async upsertShopProductTx(client, shopId, productId, data, addOnly = false) {
    const soldOutAt =
      data.stock_quantity === 0 && data.is_available === false ? new Date() : null

    const { rows } = await client.query(
      `INSERT INTO shop_products (
        shop_id, product_id,
        price, sale_price, cost_price, wholesale_price,
        stock_quantity, low_stock_threshold, max_order_qty,
        is_available, is_featured, sold_out_at
      ) VALUES (
        $1, $2,
        $3, $4, $5, $6,
        $7, $8, $9,
        $10, $11, $12
      )
      ON CONFLICT (shop_id, product_id) DO UPDATE SET
        price = EXCLUDED.price,
        sale_price = EXCLUDED.sale_price,
        cost_price = EXCLUDED.cost_price,
        wholesale_price = EXCLUDED.wholesale_price,
        stock_quantity = EXCLUDED.stock_quantity,
        low_stock_threshold = EXCLUDED.low_stock_threshold,
        max_order_qty = EXCLUDED.max_order_qty,
        is_available = EXCLUDED.is_available,
        is_featured = EXCLUDED.is_featured,
        sold_out_at = EXCLUDED.sold_out_at,
        approval_status = 'APPROVED',
        approved_at = NULL,
        approved_by = NULL,
        rejection_reason = NULL,
        deleted_at = NULL,
        updated_at = NOW()
      WHERE NOT $13::boolean OR shop_products.deleted_at IS NOT NULL
      RETURNING id, stock_quantity`,
      [
        shopId,
        productId,
        data.price,
        data.sale_price ?? null,
        data.cost_price ?? null,
        data.wholesale_price ?? null,
        data.stock_quantity,
        data.low_stock_threshold,
        data.max_order_qty,
        data.is_available,
        data.is_featured ?? false,
        soldOutAt,
        addOnly,
      ]
    )
    return rows[0]
  }
}
