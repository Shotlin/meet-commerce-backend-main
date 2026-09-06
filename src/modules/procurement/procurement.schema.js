/**
 * Procurement, Goods Receipt & Batch Schemas
 * Source of truth: Blueprint §06.3, Phase 4A
 *
 * @module modules/procurement/procurement.schema
 */

export const CreateProcurementSchema = {
  type: 'object',
  required: ['items'],
  properties: {
    notes: { type: 'string' },
    items: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['product_id', 'quantity_ordered', 'unit_cost'],
        properties: {
          product_id: { type: 'string' },
          quantity_ordered: { type: 'number', exclusiveMinimum: 0 },
          unit_cost: { type: 'number', minimum: 0 },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
}

export const GoodsReceiptSchema = {
  type: 'object',
  required: ['receipts'],
  properties: {
    receipts: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['item_id', 'quantity_received', 'batch_number'],
        properties: {
          item_id: { type: 'string' },
          quantity_received: { type: 'number', exclusiveMinimum: 0 },
          batch_number: { type: 'string', minLength: 1, maxLength: 100 },
          manufactured_date: { type: 'string', format: 'date' },
          expiry_date: { type: 'string', format: 'date' },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
}

export const AddProcurementMediaSchema = {
  type: 'object',
  required: ['media_type', 'file_key'],
  properties: {
    media_type: { type: 'string', enum: ['IMAGE', 'INVOICE', 'PDF', 'CERTIFICATE', 'DELIVERY_NOTE', 'EVIDENCE_OTHER'] },
    file_key: { type: 'string', minLength: 1, maxLength: 255 },
    file_url: { type: 'string', maxLength: 512 },
    mime_type: { type: 'string', maxLength: 100 },
    size: { type: 'integer', minimum: 0 },
  },
  additionalProperties: false,
}
