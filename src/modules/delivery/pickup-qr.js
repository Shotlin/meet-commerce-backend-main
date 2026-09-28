/**
 * Parser for the FreshCuts invoice QR the rider scans at the store.
 *
 * Payload: `FRESHCUTS-ORDER|<orderNumber>|<orderId>` — the exact string
 * `utils/invoiceGenerator.js#buildQrPayload` prints on the invoice and the
 * customer app's on-screen order code encodes. Returns null for anything
 * that is not a well-formed FreshCuts order code.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const ORDER_QR_PREFIX = 'FRESHCUTS-ORDER'

export function parseOrderQr(raw) {
  const text = `${raw ?? ''}`.trim()
  const parts = text.split('|')
  if (parts.length !== 3 || parts[0] !== ORDER_QR_PREFIX) return null
  const orderNumber = parts[1].trim()
  const orderId = parts[2].trim()
  if (!orderNumber || !UUID_RE.test(orderId)) return null
  return { orderNumber, orderId: orderId.toLowerCase() }
}
