import ExcelJS from 'exceljs'
import { ALL_HEADERS, BULK_IMPORT_MAX_FILE_BYTES, BULK_IMPORT_MAX_ROWS } from './product-bulk-import.parser.js'

const SAMPLE_ROW = {
  product_name: 'Chicken Breast Boneless',
  category: 'Chicken',
  price: 240,
  stock_quantity: 10,
  unit: 'kg',
  sku: 'CHK-BREAST-001',
  sale_price: 220,
  cost_price: 180,
  wholesale_price: 210,
  description: 'Fresh boneless chicken breast.',
  image_urls: 'https://example.com/chicken-breast.jpg',
  low_stock_threshold: 5,
  max_order_qty: 50,
  is_available: 'true',
  is_featured: 'false',
  food_type: 'NON_VEG',
  cut_type: 'Boneless',
  net_quantity: '500 g',
  cut_options: 'Tikka|Curry Cut',
  piece_options: 'Small|Medium',
  skin_type: 'SKINLESS',
  brand: 'FreshCuts',
  shelf_life: '2 days',
  storage_instructions: 'Keep refrigerated at 0-4°C.',
}

const COLUMN_WIDTHS = {
  product_name: 28,
  category: 18,
  price: 10,
  stock_quantity: 14,
  unit: 10,
  sku: 20,
  sale_price: 12,
  cost_price: 12,
  wholesale_price: 16,
  description: 38,
  image_urls: 42,
  low_stock_threshold: 18,
  max_order_qty: 15,
  is_available: 14,
  is_featured: 13,
  food_type: 13,
  cut_type: 15,
  net_quantity: 14,
  cut_options: 30,
  piece_options: 28,
  skin_type: 13,
  brand: 16,
  shelf_life: 14,
  storage_instructions: 36,
}

function addInstructionsSheet(workbook) {
  const sheet = workbook.addWorksheet('Instructions')
  sheet.columns = [{ width: 110 }]
  const lines = [
    ['FreshCuts product bulk import — instructions'],
    [''],
    [`Required columns: ${['product_name', 'category', 'price', 'stock_quantity', 'unit'].join(', ')}`],
    ['category must match an existing category name or slug. The dashboard may set a default category for blank cells.'],
    ['sku is matched first. Without sku, product_name + category is used.'],
    ['If no master product matches, a new master product is created and attached to the selected store.'],
    ['Existing store products are skipped by default. Use UPDATE_EXISTING mode to update price and stock.'],
    ['image_urls, cut_options and piece_options use the pipe character | as a separator.'],
    ['Boolean columns accept true/false.'],
    ['unit must be one of: kg, g, l, ml, piece, pack, dozen, box.'],
    ['food_type: VEG, NON_VEG, EGG, NONE. skin_type: SKIN_ON, SKINLESS, NONE.'],
    [`Limits: ${BULK_IMPORT_MAX_ROWS} rows and ${Math.round(BULK_IMPORT_MAX_FILE_BYTES / (1024 * 1024))} MB.`],
    [''],
    ['The sample row uses a placeholder category. Replace it with a category that already exists in FreshCuts.'],
  ]
  lines.forEach((line, index) => {
    const row = sheet.addRow(line)
    if (index === 0) row.font = { bold: true, size: 14 }
  })
}

export async function buildXlsxTemplate() {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'FreshCuts'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet('Products')
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.columns = ALL_HEADERS.map((header) => ({
    header,
    key: header,
    width: COLUMN_WIDTHS[header] ?? 16,
  }))
  sheet.addRow(SAMPLE_ROW)

  const header = sheet.getRow(1)
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF15161B' } }
  header.alignment = { vertical: 'middle' }

  const listValidations = [
    { range: 'E2:E1001', formula: '"kg,g,l,ml,piece,pack,dozen,box"', title: 'Invalid unit' },
    { range: 'N2:O1001', formula: '"true,false"', title: 'Use true or false' },
    { range: 'P2:P1001', formula: '"VEG,NON_VEG,EGG,NONE"', title: 'Invalid food type' },
    { range: 'U2:U1001', formula: '"SKIN_ON,SKINLESS,NONE"', title: 'Invalid skin type' },
  ]
  for (const item of listValidations) {
    sheet.dataValidations.add(item.range, {
      type: 'list',
      allowBlank: true,
      formulae: [item.formula],
      showErrorMessage: true,
      errorTitle: item.title,
      error: 'Choose a value from the dropdown list.',
    })
  }

  addInstructionsSheet(workbook)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

function csvEscape(value) {
  const text = String(value ?? '')
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function buildCsvTemplate() {
  const header = ALL_HEADERS.join(',')
  const sample = ALL_HEADERS.map((key) => csvEscape(SAMPLE_ROW[key] ?? '')).join(',')
  return Buffer.from(`${header}\r\n${sample}\r\n`, 'utf8')
}
