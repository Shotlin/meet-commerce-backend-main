/**
 * Procurement Activity & Evidence Schemas
 * Source of truth: Blueprint §06.3, Phase 4B
 *
 * @module modules/procurement/procurement-activity.schema
 */

export const AddCommentSchema = {
  type: 'object',
  required: ['comment'],
  properties: {
    comment: { type: 'string', minLength: 1, maxLength: 2000 },
  },
  additionalProperties: false,
}

export const AddCategorizedMediaSchema = {
  type: 'object',
  required: ['media_type', 'file_key'],
  properties: {
    media_type: { type: 'string', enum: ['IMAGE', 'INVOICE', 'PDF', 'CERTIFICATE', 'DELIVERY_NOTE', 'EVIDENCE_OTHER'] },
    file_key: { type: 'string', minLength: 1, maxLength: 255 },
    file_url: { type: 'string', maxLength: 512 },
    mime_type: { type: 'string', maxLength: 100 },
    size: { type: 'integer', minimum: 0 },
    category: { type: 'string', maxLength: 100, default: 'GENERAL' },
    sort_order: { type: 'integer', default: 0 },
  },
  additionalProperties: false,
}
