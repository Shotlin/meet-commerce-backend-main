/**
 * Support Tickets, Recalls & Traceability Schemas
 * Source of truth: Blueprint §06.9, Phase 10
 *
 * @module modules/support/support.schema
 */

export const CreateTicketSchema = {
  type: 'object',
  required: ['subject', 'description'],
  properties: {
    subject: { type: 'string', minLength: 3, maxLength: 255 },
    description: { type: 'string', minLength: 5 },
  },
  additionalProperties: false,
}

export const AssignTicketSchema = {
  type: 'object',
  required: ['assigned_to'],
  properties: {
    assigned_to: { type: 'string' },
  },
  additionalProperties: false,
}

export const UpdateTicketStatusSchema = {
  type: 'object',
  required: ['status'],
  properties: {
    status: { type: 'string', enum: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REOPENED'] },
    notes: { type: 'string' },
  },
  additionalProperties: false,
}

export const AddTicketCommentSchema = {
  type: 'object',
  required: ['comment'],
  properties: {
    comment: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
}

export const CreateRecallSchema = {
  type: 'object',
  required: ['title', 'reason'],
  properties: {
    title: { type: 'string', minLength: 3, maxLength: 255 },
    reason: { type: 'string', minLength: 5 },
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['product_id'],
        properties: {
          product_id: { type: 'string' },
          batch_id: { type: 'string' },
          batch_number: { type: 'string' },
          affected_quantity: { type: 'number', minimum: 0 },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
}
