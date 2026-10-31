const UUID_PATTERN = {
  type: 'string',
  pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
}

export const BulkImportTemplateQuerySchema = {
  type: 'object',
  properties: {
    format: { type: 'string', enum: ['xlsx', 'csv'], default: 'xlsx' },
  },
  additionalProperties: false,
}

export const BulkImportPreviewQuerySchema = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['ADD_ONLY', 'UPDATE_EXISTING'], default: 'ADD_ONLY' },
    default_category: UUID_PATTERN,
  },
  additionalProperties: false,
}

export const BulkImportCommitQuerySchema = {
  ...BulkImportPreviewQuerySchema,
}
