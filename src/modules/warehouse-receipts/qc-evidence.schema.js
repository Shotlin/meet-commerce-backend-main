/**
 * QC Evidence, Defects & Dispositions Schemas
 * Source of truth: Blueprint §06.4, Phase 5B
 *
 * @module modules/warehouse-receipts/qc-evidence.schema
 */

export const AddQcMediaSchema = {
  type: 'object',
  required: ['media_type', 'file_key'],
  properties: {
    media_type: { type: 'string', enum: ['IMAGE', 'VIDEO', 'PDF', 'CERTIFICATE', 'INSPECTION_REPORT'] },
    file_key: { type: 'string', minLength: 1, maxLength: 255 },
    file_url: { type: 'string', maxLength: 512 },
    mime_type: { type: 'string', maxLength: 100 },
    size: { type: 'integer', minimum: 0 },
    category: { type: 'string', maxLength: 100, default: 'GENERAL' },
  },
  additionalProperties: false,
}

export const AddDefectSchema = {
  type: 'object',
  required: ['title', 'category', 'severity'],
  properties: {
    title: { type: 'string', minLength: 2, maxLength: 255 },
    category: { type: 'string', minLength: 1, maxLength: 100 },
    severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
    description: { type: 'string' },
    action_plan: { type: 'string' }, // Required if severity is CRITICAL
  },
  additionalProperties: false,
}

export const SubmitDispositionSchema = {
  type: 'object',
  required: ['status'],
  properties: {
    status: { type: 'string', enum: ['ACCEPT', 'REWORK', 'RETURN', 'REJECT'] },
    remarks: { type: 'string' },
  },
  additionalProperties: false,
}
