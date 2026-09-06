/**
 * Orders & Fulfilment Schemas
 * Source of truth: Blueprint §06.7, Phase 8
 *
 * @module modules/orders/orders.schema
 */

export const CreateOrderFromQuoteSchema = {
  type: 'object',
  required: ['quote_number'],
  properties: {
    quote_number: { type: 'string', minLength: 1 },
    warehouse_id: { type: 'string' },
  },
  additionalProperties: false,
}

export const UpdateOrderStatusSchema = {
  type: 'object',
  required: ['status'],
  properties: {
    status: {
      type: 'string',
      enum: [
        'CART_CREATED', 'ORDER_PLACED', 'PAYMENT_PENDING', 'PAYMENT_CONFIRMED',
        'CONFIRMED', 'ALLOCATING_STOCK', 'STOCK_RESERVED', 'PICKING', 'PACKING',
        'READY_FOR_DISPATCH', 'DISPATCHED', 'OUT_FOR_DELIVERY', 'DELIVERED',
        'COMPLETED', 'CANCELLED', 'PAYMENT_FAILED', 'RETURN_REQUESTED', 'RETURNED'
      ],
    },
    notes: { type: 'string' },
  },
  additionalProperties: false,
}

export const CreateFulfilmentTaskSchema = {
  type: 'object',
  required: ['task_type'],
  properties: {
    task_type: { type: 'string', enum: ['PICKING', 'PACKING'] },
    assigned_to: { type: 'string' },
    notes: { type: 'string' },
  },
  additionalProperties: false,
}

export const UpdateFulfilmentTaskSchema = {
  type: 'object',
  required: ['status'],
  properties: {
    status: { type: 'string', enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED'] },
    notes: { type: 'string' },
  },
  additionalProperties: false,
}
