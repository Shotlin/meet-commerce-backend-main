import { query, closePool } from '../src/config/database.js'
import { VendorProcurementService } from '../src/modules/vendor-procurement/vendor-procurement.service.js'
import { ShopProductsService } from '../src/modules/shop-products/shop-products.service.js'
import { ShopProductsRepository } from '../src/modules/shop-products/shop-products.repository.js'

const SHOP_ID = '6f52f5c7-8884-4577-981e-3bcbc0515977' // FreshCuts Kolkata
const PRODUCT_ID = 'f5395377-d973-4c3c-b55e-d81282c3ec96' // Amul Butter — 100g
const CATEGORY_ID = 'e1101694-e467-480f-a77b-c6e35578afb3'
const SHOP_PRODUCT_ID = '647692a1-a721-460b-a9f3-e0e7fde0ab97'
const suffix = Math.random().toString(36).slice(2, 8)

const service = new VendorProcurementService()
const shopProductsService = new ShopProductsService(new ShopProductsRepository())

async function main() {
  const before = await query('SELECT stock_quantity FROM shop_products WHERE id = $1', [SHOP_PRODUCT_ID])
  console.log('Stock before receipt:', before.rows[0].stock_quantity)

  const vendor = await query(
    `INSERT INTO vendors (name, slug, email, phone, status) VALUES ($1,$2,$3,$4,'ACTIVE') RETURNING id`,
    [`Verify Vendor ${suffix}`, `verify-vendor-${suffix}`, `verify-${suffix}@example.test`, `9${suffix.replace(/\D/g, '').padEnd(9, '1').slice(0, 9)}`]
  )
  const vendorId = vendor.rows[0].id

  const request = await query(
    `INSERT INTO procurement_requests (request_number, shop_id, mode, status, title, required_delivery_at, response_deadline, offer_total)
     VALUES ($1,$2,'FIXED_OFFER','PUBLISHED',$3, NOW() + interval '2 days', NOW() + interval '1 day', 2500)
     RETURNING id`,
    [`PRQ-VERIFY-${suffix}`, SHOP_ID, 'Verify shop-stock sync']
  )
  const requestId = request.rows[0].id

  await query(
    `INSERT INTO procurement_request_items (request_id, category_id, item_name, requested_quantity, unit, fixed_unit_price, fixed_line_total)
     VALUES ($1,$2,'Amul Butter',10,'PC',250,2500)`,
    [requestId, CATEGORY_ID]
  )

  await query(
    `INSERT INTO procurement_recipients (request_id, vendor_id, eligibility) VALUES ($1,$2,'{}'::jsonb)`,
    [requestId, vendorId]
  )

  const accept = await service.acceptFixedOffer(requestId, vendorId, null)
  const supplyId = accept.supply_order.id
  console.log('Supply order created:', accept.supply_order.supply_number, supplyId)

  for (const status of ['ACCEPTED', 'PROCESSING', 'CLEANING']) {
    await service.updateSupplyStatus(supplyId, vendorId, null, status)
  }
  await service.attachEvidence(supplyId, vendorId, null, {
    media_public_id: `verify-${suffix}`,
    media_url: 'https://example.test/verify.mp4',
  })
  for (const status of ['PACKED', 'READY_FOR_DISPATCH', 'DISPATCHED']) {
    await service.updateSupplyStatus(supplyId, vendorId, null, status)
  }
  await service.markDelivered(supplyId, null)

  const supplyItem = await query('SELECT id FROM procurement_supply_order_items WHERE supply_order_id = $1 LIMIT 1', [supplyId])
  const receiptResult = await service.receiveSupply(supplyId, null, {
    items: [
      {
        supply_order_item_id: supplyItem.rows[0].id,
        received_quantity: 10,
        accepted_quantity: 10,
        rejected_quantity: 0,
        product_id: PRODUCT_ID,
      },
    ],
  })
  console.log('Receipt inventory result:', JSON.stringify(receiptResult.inventory, null, 2))

  const after = await query('SELECT stock_quantity FROM shop_products WHERE id = $1', [SHOP_PRODUCT_ID])
  console.log('Stock after receipt:', after.rows[0].stock_quantity)

  const movement = await query(
    `SELECT type, quantity_delta, quantity_before, quantity_after, source, metadata FROM stock_movements
     WHERE shop_product_id = $1 AND type = 'PROCUREMENT_RECEIPT' ORDER BY created_at DESC LIMIT 1`,
    [SHOP_PRODUCT_ID]
  )
  console.log('stock_movements row:', JSON.stringify(movement.rows[0], null, 2))

  const lots = await shopProductsService.getInventoryLots(SHOP_ID, SHOP_PRODUCT_ID)
  console.log('getInventoryLots result:', JSON.stringify(lots, null, 2))

  // Cleanup — restore the shop_product to its pre-verification state so the
  // dashboard session left open still shows consistent data afterward.
  const lotId = receiptResult.inventory[0]?.inventory_lot_id
  await query('DELETE FROM procurement_receipt_items WHERE receipt_id IN (SELECT id FROM procurement_receipts WHERE supply_order_id = $1)', [supplyId])
  await query('DELETE FROM procurement_receipts WHERE supply_order_id = $1', [supplyId])
  await query('DELETE FROM procurement_evidence WHERE supply_order_id = $1', [supplyId])
  await query('DELETE FROM procurement_supply_events WHERE supply_order_id = $1', [supplyId])
  await query('DELETE FROM procurement_supply_order_items WHERE supply_order_id = $1', [supplyId])
  await query('DELETE FROM procurement_supply_orders WHERE id = $1', [supplyId])
  await query('DELETE FROM procurement_recipients WHERE request_id = $1', [requestId])
  await query('DELETE FROM procurement_request_items WHERE request_id = $1', [requestId])
  await query('DELETE FROM procurement_requests WHERE id = $1', [requestId])
  await query('DELETE FROM vendors WHERE id = $1', [vendorId])
  if (lotId) {
    await query('DELETE FROM stock_ledger_entries WHERE lot_id = $1', [lotId])
    await query('DELETE FROM inventory_lots WHERE id = $1', [lotId])
  }
  await query(`DELETE FROM stock_movements WHERE shop_product_id = $1 AND type = 'PROCUREMENT_RECEIPT'`, [SHOP_PRODUCT_ID])
  await query('UPDATE shop_products SET stock_quantity = 8 WHERE id = $1', [SHOP_PRODUCT_ID])

  console.log('Cleanup done.')
  await closePool()
}

main().catch(async (err) => {
  console.error('FAILED', err)
  await closePool()
  process.exit(1)
})
