import ExcelJS from 'exceljs'
import { parse as parseCsv } from 'csv-parse/sync'

export const BULK_IMPORT_MAX_ROWS = 2000
export const BULK_IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024

export const REQUIRED_HEADERS = [
  'product_name',
  'category',
  'price',
  'stock_quantity',
  'unit',
]

export const OPTIONAL_HEADERS = [
  'sku',
  'sale_price',
  'cost_price',
  'wholesale_price',
  'description',
  'image_urls',
  'low_stock_threshold',
  'max_order_qty',
  'is_available',
  'is_featured',
  'food_type',
  'cut_type',
  'net_quantity',
  'cut_options',
  'piece_options',
  'skin_type',
  'brand',
  'shelf_life',
  'storage_instructions',
]

export const ALL_HEADERS = [...REQUIRED_HEADERS, ...OPTIONAL_HEADERS]

const HEADER_ALIASES = {
  name: 'product_name',
  product: 'product_name',
  productname: 'product_name',
  category_name: 'category',
  stock: 'stock_quantity',
  qty: 'stock_quantity',
  image: 'image_urls',
  image_url: 'image_urls',
  images: 'image_urls',
  sale: 'sale_price',
  cost: 'cost_price',
  wholesale: 'wholesale_price',
  low_stock: 'low_stock_threshold',
  max_qty: 'max_order_qty',
  available: 'is_available',
  featured: 'is_featured',
  cuts: 'cut_options',
  pieces: 'piece_options',
}

export function bulkImportError(message, statusCode = 422, code = 'BULK_IMPORT_INVALID', details = null) {
  const err = new Error(message)
  err.statusCode = statusCode
  err.code = code
  if (details) err.details = details
  return err
}

export function normalizeHeader(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return HEADER_ALIASES[normalized] ?? normalized
}

export function cellText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text ?? '').join('').trim()
    }
    if (value.text !== undefined && value.text !== null) return String(value.text).trim()
    if (value.result !== undefined && value.result !== null) return String(value.result).trim()
    if (value.hyperlink !== undefined && value.hyperlink !== null) return String(value.hyperlink).trim()
  }
  return String(value).trim()
}

function assertHeaders(headers) {
  if (headers.length === 0) {
    throw bulkImportError('The file has no header row', 422, 'BULK_IMPORT_EMPTY')
  }
  const seen = new Set()
  for (const header of headers) {
    if (seen.has(header)) {
      throw bulkImportError(
        `Duplicate column "${header}"`,
        422,
        'BULK_IMPORT_DUPLICATE_HEADER',
        { header }
      )
    }
    seen.add(header)
  }
  const missing = REQUIRED_HEADERS.filter((header) => !seen.has(header))
  if (missing.length > 0) {
    throw bulkImportError(
      `Missing required column(s): ${missing.join(', ')}`,
      422,
      'BULK_IMPORT_MISSING_HEADERS',
      { missing }
    )
  }
}

function pushRow(rows, rowNumber, values) {
  const hasValue = Object.values(values).some((value) => String(value ?? '').trim() !== '')
  if (!hasValue) return
  if (rows.length >= BULK_IMPORT_MAX_ROWS) {
    throw bulkImportError(
      `The file has more than ${BULK_IMPORT_MAX_ROWS} data rows`,
      422,
      'BULK_IMPORT_TOO_MANY_ROWS',
      { max_rows: BULK_IMPORT_MAX_ROWS }
    )
  }
  rows.push({ row: rowNumber, values })
}

function parseCsvBuffer(buffer) {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '')
  if (!text.trim()) {
    throw bulkImportError('The file is empty', 422, 'BULK_IMPORT_EMPTY')
  }

  let headerRows
  try {
    headerRows = parseCsv(text, { to_line: 1, skip_empty_lines: false })
  } catch (err) {
    throw bulkImportError(`Could not read the CSV: ${err.message}`, 422, 'BULK_IMPORT_PARSE_FAILED')
  }

  const rawHeaders = headerRows?.[0] ?? []
  const headers = rawHeaders.map(normalizeHeader)
  assertHeaders(headers)

  let records
  try {
    records = parseCsv(text, {
      columns: headers,
      from_line: 2,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: true,
    })
  } catch (err) {
    throw bulkImportError(`Could not read the CSV: ${err.message}`, 422, 'BULK_IMPORT_PARSE_FAILED')
  }

  const rows = []
  records.forEach((record, index) => {
    const values = {}
    for (const header of headers) values[header] = record[header] ?? ''
    pushRow(rows, index + 2, values)
  })

  return { format: 'csv', headers, rows }
}

async function parseXlsxBuffer(buffer) {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(buffer)
  } catch (err) {
    throw bulkImportError(
      `Could not read the XLSX file: ${err.message}`,
      422,
      'BULK_IMPORT_PARSE_FAILED'
    )
  }

  const worksheet = workbook.worksheets[0]
  if (!worksheet) {
    throw bulkImportError('The workbook has no worksheet', 422, 'BULK_IMPORT_EMPTY')
  }

  const headerRow = worksheet.getRow(1)
  const headerIndex = new Map()
  const headers = []
  headerRow.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
    const header = normalizeHeader(cellText(cell.value))
    if (!header) return
    if (headerIndex.has(header)) {
      throw bulkImportError(
        `Duplicate column "${header}"`,
        422,
        'BULK_IMPORT_DUPLICATE_HEADER',
        { header }
      )
    }
    headerIndex.set(header, columnNumber)
    headers.push(header)
  })
  assertHeaders(headers)

  const rows = []
  let physicalRows = 0
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return
    physicalRows += 1
    if (physicalRows > BULK_IMPORT_MAX_ROWS) {
      throw bulkImportError(
        `The file has more than ${BULK_IMPORT_MAX_ROWS} data rows`,
        422,
        'BULK_IMPORT_TOO_MANY_ROWS',
        { max_rows: BULK_IMPORT_MAX_ROWS }
      )
    }
    const values = {}
    for (const [header, columnNumber] of headerIndex.entries()) {
      values[header] = cellText(row.getCell(columnNumber).value)
    }
    pushRow(rows, rowNumber, values)
  })

  return { format: 'xlsx', headers, rows }
}

/**
 * Parse an uploaded CSV/XLSX buffer into normalized header + row objects.
 * Validation against the catalog happens later so preview and commit share
 * exactly the same parse result.
 */
export async function parseBulkImportFile({ buffer, filename, mimetype }) {
  if (!buffer || buffer.length === 0) {
    throw bulkImportError('The file is empty', 422, 'BULK_IMPORT_EMPTY')
  }
  if (buffer.length > BULK_IMPORT_MAX_FILE_BYTES) {
    throw bulkImportError(
      'The file is larger than 10 MB',
      413,
      'BULK_IMPORT_FILE_TOO_LARGE'
    )
  }

  const extension = String(filename ?? '').toLowerCase().split('.').pop()
  const mime = String(mimetype ?? '').toLowerCase()

  if (extension === 'csv' || mime === 'text/csv') return parseCsvBuffer(buffer)
  if (
    extension === 'xlsx' ||
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return parseXlsxBuffer(buffer)
  }

  throw bulkImportError(
    'Upload a .csv or .xlsx file',
    422,
    'BULK_IMPORT_UNSUPPORTED_FILE'
  )
}

/** Number parser shared by row validation. */
export function parseNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const numeric = Number(String(value).replace(/[₹,\s]/g, ''))
  return Number.isFinite(numeric) ? numeric : Number.NaN
}

export function parseBoolean(value) {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized) return null
  if (['true', 'yes', 'y', '1'].includes(normalized)) return true
  if (['false', 'no', 'n', '0'].includes(normalized)) return false
  return undefined
}

export function parseList(value) {
  return String(value ?? '')
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean)
}
