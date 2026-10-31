import { success } from '../../utils/apiResponse.js'
import { bulkImportError, BULK_IMPORT_MAX_FILE_BYTES } from './product-bulk-import.parser.js'
import { buildCsvTemplate, buildXlsxTemplate } from './product-bulk-import.template.js'

export class ProductBulkImportController {
  constructor(service) {
    this.service = service
  }

  downloadTemplate = async (request, reply) => {
    const format = request.query?.format ?? 'xlsx'
    const isCsv = format === 'csv'
    const buffer = isCsv ? buildCsvTemplate() : await buildXlsxTemplate()

    reply.header(
      'Content-Type',
      isCsv
        ? 'text/csv; charset=utf-8'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    reply.header(
      'Content-Disposition',
      `attachment; filename="product-bulk-import-template.${isCsv ? 'csv' : 'xlsx'}"`
    )
    reply.header('Content-Length', buffer.length)
    return reply.send(buffer)
  }

  async readUpload(request) {
    let file
    try {
      file = await request.file({ limits: { fileSize: BULK_IMPORT_MAX_FILE_BYTES } })
    } catch (err) {
      if (err?.code === 'FST_REQ_FILE_TOO_LARGE') {
        throw bulkImportError(
          'The file is larger than 10 MB',
          413,
          'BULK_IMPORT_FILE_TOO_LARGE'
        )
      }
      throw bulkImportError(
        'Upload a CSV or XLSX file using multipart/form-data',
        422,
        'BULK_IMPORT_FILE_REQUIRED'
      )
    }

    if (!file) {
      throw bulkImportError('Upload a CSV or XLSX file', 422, 'BULK_IMPORT_FILE_REQUIRED')
    }

    let buffer
    try {
      buffer = await file.toBuffer()
    } catch (err) {
      if (err?.code === 'FST_REQ_FILE_TOO_LARGE' || file.file?.truncated) {
        throw bulkImportError(
          'The file is larger than 10 MB',
          413,
          'BULK_IMPORT_FILE_TOO_LARGE'
        )
      }
      throw bulkImportError('Could not read the uploaded file', 422, 'BULK_IMPORT_PARSE_FAILED')
    }

    if (file.file?.truncated) {
      throw bulkImportError(
        'The file is larger than 10 MB',
        413,
        'BULK_IMPORT_FILE_TOO_LARGE'
      )
    }

    return {
      buffer,
      filename: file.filename,
      mimetype: file.mimetype,
    }
  }

  preview = async (request, reply) => {
    const upload = await this.readUpload(request)
    const result = await this.service.preview({
      ...upload,
      shopId: request.shopId ?? null,
      mode: request.query?.mode ?? 'ADD_ONLY',
      defaultCategoryId: request.query?.default_category ?? null,
    })
    return reply.code(200).send(success(result, 'Bulk import preview ready'))
  }

  commit = async (request, reply) => {
    const upload = await this.readUpload(request)
    const result = await this.service.commit({
      ...upload,
      shopId: request.shopId ?? null,
      mode: request.query?.mode ?? 'ADD_ONLY',
      defaultCategoryId: request.query?.default_category ?? null,
      actorId: request.userId ?? request.user?.id ?? null,
    })
    return reply.code(200).send(success(result, 'Bulk import completed'))
  }
}
