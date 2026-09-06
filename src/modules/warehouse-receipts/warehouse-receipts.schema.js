/**
 * Warehouse Receipts & Quality Control Schemas
 * Source of truth: Blueprint §06.4, Phase 5A
 *
 * @module modules/warehouse-receipts/warehouse-receipts.schema
 */

export const CreateReceiptSchema = {
  type: 'object',
  required: ['warehouse_id', 'items'],
  properties: {
    warehouse_id: { type: 'string' },
    procurement_order_id: { type: 'string' },
    notes: { type: 'string' },
    items: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['product_id', 'quantity_received'],
        properties: {
          batch_id: { type: 'string' },
          product_id: { type: 'string' },
          quantity_received: { type: 'number', exclusiveMinimum: 0 },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
}

export const PerformQcSchema = {
  type: 'object',
  required: ['result', 'item_results'],
  properties: {
    result: { type: 'string', enum: ['PASS', 'FAIL', 'CONDITIONAL_PASS'] },
    notes: { type: 'string' },
    item_results: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['receipt_item_id', 'quantity_accepted', 'quantity_rejected'],
        properties: {
          receipt_item_id: { type: 'string' },
          quantity_accepted: { type: 'number', minimum: 0 },
          quantity_rejected: { type: 'number', minimum: 0 },
          parameters: {
            type: 'array',
            items: {
              type: 'object',
              required: ['parameter_name', 'status'],
              properties: {
                parameter_name: { type: 'string', minLength: 1, maxLength: 100 },
                status: { type: 'string', enum: ['PASS', 'FAIL'] },
                remarks: { type: 'string' },
              },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
}
