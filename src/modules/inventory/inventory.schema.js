/**
 * Inventory & FEFO Reservation Schemas & DTO Validation
 * Source of truth: Blueprint §06.5, Phase 6
 *
 * @module modules/inventory/inventory.schema
 */

export const StockInboundSchema = {
  type: 'object',
  required: ['warehouse_id', 'product_id', 'batch_number', 'expiry_date', 'quantity'],
  properties: {
    warehouse_id: { type: 'string' },
    product_id: { type: 'string' },
    batch_id: { type: ['string', 'null'] },
    batch_number: { type: 'string', minLength: 1, maxLength: 100 },
    expiry_date: { type: 'string', format: 'date' },
    quantity: { type: 'number', exclusiveMinimum: 0 },
  },
  additionalProperties: false,
}

export const ReserveFefoSchema = {
  type: 'object',
  required: ['warehouse_id', 'product_id', 'quantity', 'reservation_key'],
  properties: {
    warehouse_id: { type: 'string' },
    product_id: { type: 'string' },
    quantity: { type: 'number', exclusiveMinimum: 0 },
    reservation_key: { type: 'string', minLength: 1, maxLength: 255 },
    ttl_seconds: { type: 'integer', default: 900 }, // 15 min TTL
  },
  additionalProperties: false,
}

export const ReleaseReservationSchema = {
  type: 'object',
  required: ['reservation_key'],
  properties: {
    reservation_key: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
}

export const StockAdjustmentSchema = {
  type: 'object',
  required: ['lot_id', 'quantity_change', 'reason'],
  properties: {
    lot_id: { type: 'string' },
    quantity_change: { type: 'number' },
    reason: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
}
