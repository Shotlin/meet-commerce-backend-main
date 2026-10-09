/**
 * WhatsApp message templates + variation engine. Pure functions only.
 *
 * Template syntax
 *   {{name}}            — a variable (see TEMPLATE_VARIABLES)
 *   {Hi|Hello|Hey}      — pick one at random each send (can be nested)
 *   {text|}             — "text" or nothing
 *
 * An event holds SEVERAL full templates ("variants"). Every send picks a
 * variant that is not the one used last, resolves the {a|b} choices, and
 * re-rolls if the final text would be identical to the previous message for
 * that event — so two customers never receive a copy-paste of one another,
 * while each message still reads as a normal, human order update.
 */

export const TEMPLATE_VARIABLES = [
  { key: 'name', desc: 'Customer full name' },
  { key: 'firstName', desc: 'Customer first name' },
  { key: 'orderNumber', desc: 'Order number, e.g. FC-KOL-20261001-0001' },
  { key: 'total', desc: 'Amount payable, e.g. ₹380' },
  { key: 'itemSummary', desc: '"1 item" / "3 items"' },
  { key: 'items', desc: 'Item list (format varies each time)' },
  { key: 'shopName', desc: 'Store name' },
  { key: 'paymentNote', desc: 'Cash on delivery / paid online note' },
]

const SAMPLE_VARS = {
  name: 'Rahul Sharma',
  firstName: 'Rahul',
  orderNumber: 'FC-KOL-20261001-0001',
  total: '₹380',
  itemSummary: '2 items',
  items: '• 1 × Chicken Breast Boneless (500 g)\n• 1 × Free Range Eggs (10)',
  shopName: 'FreshCuts Kolkata',
  paymentNote: 'Pay cash on delivery',
}

export const WHATSAPP_EVENTS = [
  {
    key: 'FIRST_ORDER',
    label: 'First order (new customer)',
    hint: 'Sent instead of "Order placed" when this is the customer\'s very first order.',
    defaultEnabled: true,
    defaultVariants: [
      '{Hi|Hello|Hey} {{firstName}}, {welcome to FreshCuts|thanks for choosing FreshCuts|great to have you with us} 🙌\n\nYour first order {{orderNumber}} {is in|has been placed|is confirmed} ✅\n{{itemSummary}} · {{total}}\n{{items}}\n\n{{paymentNote}}. {We\'ll keep you posted.|You\'ll get an update when it\'s on the way.}',
      '{{firstName}}, {thank you for your first order|your first FreshCuts order is confirmed} 🎉\n\n{Order|Ref} {{orderNumber}} • {{total}}\n{{items}}\n\n{We\'re getting it ready now.|Fresh and on its way soon.} – {{shopName}}',
      '{Hello|Hi} {{firstName}}! {Your order|Order} {{orderNumber}} {is booked|is placed|has reached us} ✅ {Welcome aboard|Happy to serve you}.\n\n{{itemSummary}}, {{total}}.\n{{paymentNote}}.\n\n{We\'ll message you as it moves along.|More updates soon.}',
      '{{firstName}}, {welcome!|nice to meet you!} 👋 {We\'ve received|We got} your order {{orderNumber}} ({{total}}).\n{{items}}\n{{paymentNote}}. {Sit tight, we\'ll update you.|Updates will follow here.}',
    ],
  },
  {
    key: 'ORDER_PLACED',
    label: 'Order placed / confirmed',
    hint: 'The main confirmation sent right after an order is placed (or paid online).',
    defaultEnabled: true,
    defaultVariants: [
      '{Hi|Hello|Hey} {{firstName}}, {thanks for your order|your order is in|we\'ve received your order} 🙌\n\n{Order|Ref} {{orderNumber}} · {{total}}\n{{items}}\n\n{{paymentNote}}. {We\'ll update you once it\'s on the way.|You\'ll hear from us as it moves along.} – {{shopName}}',
      '{{firstName}}, your order {{orderNumber}} {is confirmed|has been placed|is booked} ✅\n{{itemSummary}} • {{total}}\n\n{Thank you for choosing FreshCuts.|We\'re getting it ready now.|Fresh stuff coming your way soon.}',
      '{Hello|Hi} {{firstName}}! {We\'ve got|Received} your order {{orderNumber}} ({{total}}).\n{{items}}\n{{paymentNote}}.\n\n{We\'ll message you when it\'s out for delivery.|More updates soon.}',
      '{{firstName}}, {all set|done} ✅ {Order|Your order} {{orderNumber}} {is in the system|is placed|is confirmed}.\n{{itemSummary}}, {{total}}. {{paymentNote}}.\n{Thanks!|Thank you!|Appreciate it!} – {{shopName}}',
      '{Thanks|Thank you} {{firstName}} 🙏 {Your|The} order {{orderNumber}} {is confirmed|has been received}.\n\n{{items}}\n{{total}} · {{paymentNote}}\n\n{We\'ll keep you posted here.|Updates will come on this chat.}',
    ],
  },
  {
    key: 'CONFIRMED',
    label: 'Order accepted by store',
    hint: 'The store accepted the order. Off by default — it can feel repetitive after the confirmation.',
    defaultEnabled: false,
    defaultVariants: [
      '{Good news|Update} {{firstName}} — {{shopName}} {has accepted|confirmed} your order {{orderNumber}} 👍',
      '{{firstName}}, order {{orderNumber}} {is confirmed by the store|has been accepted}. {Packing begins shortly.|We\'re on it.}',
      '{Hi|Hello} {{firstName}}, {the store is on it|your order is accepted} — {{orderNumber}}.',
    ],
  },
  {
    key: 'PACKED',
    label: 'Order packed',
    hint: 'Packed and waiting for the delivery partner. Off by default.',
    defaultEnabled: false,
    defaultVariants: [
      '{{firstName}}, order {{orderNumber}} {is packed|is packed and ready} 📦 {A delivery partner will pick it up shortly.|Pickup is next.}',
      '{Update|Quick update}: {{orderNumber}} {has been packed|is ready}. {On its way soon.|Rider pickup next.}',
      '{Hi|Hello} {{firstName}}, {your order is packed|packing is done} — {{orderNumber}} 📦',
    ],
  },
  {
    key: 'PICKED_UP',
    label: 'Out for delivery',
    hint: 'The rider picked up the order. (The delivery OTP is never sent over WhatsApp.)',
    defaultEnabled: false,
    defaultVariants: [
      '{{firstName}}, your order {{orderNumber}} is {out for delivery|on its way} 🛵 {Please keep your phone handy.|Please be reachable.}',
      '{On the way|Heads up} {{firstName}} — {{orderNumber}} {has left the store|is with our rider now} 🛵 {Check the app for the delivery code.|The delivery code is in the app.}',
      '{Hi|Hello} {{firstName}}, {rider is heading to you|your delivery is moving} with {{orderNumber}}. {See you soon!|Almost there.}',
    ],
  },
  {
    key: 'DELIVERED',
    label: 'Delivered',
    hint: 'Order delivered. Off by default.',
    defaultEnabled: false,
    defaultVariants: [
      '{{firstName}}, order {{orderNumber}} {has been delivered|is delivered} ✅ {Hope you enjoy it!|Enjoy!|Thank you for ordering with FreshCuts.}',
      '{Delivered|All done} {{firstName}} — {{orderNumber}} {reached you|is with you}. {Thanks for choosing FreshCuts.|Let us know if anything is off.}',
      '{Hi|Hello} {{firstName}}, {your order was delivered|delivery complete}: {{orderNumber}} 🙌 {Do reach out if something\'s not right.|We\'d love to serve you again.}',
    ],
  },
  {
    key: 'CANCELLED',
    label: 'Order cancelled',
    hint: 'Order cancelled (by customer, store or system).',
    defaultEnabled: false,
    defaultVariants: [
      '{{firstName}}, order {{orderNumber}} {has been cancelled|was cancelled}. {If you paid online, the amount will be returned to you.|Any online payment will be refunded.}',
      '{Hi|Hello} {{firstName}}, {we\'ve cancelled|cancellation done for} {{orderNumber}}. {Reply here if you need help.|Sorry for the trouble.}',
      '{Update|Note}: order {{orderNumber}} is {cancelled|now cancelled}. {Refunds, if any, are processed automatically.|We hope to serve you soon.}',
    ],
  },
  {
    key: 'REFUNDED',
    label: 'Refund processed',
    hint: 'A refund was issued for the order.',
    defaultEnabled: false,
    defaultVariants: [
      '{{firstName}}, your refund for order {{orderNumber}} {has been processed|is done} 💰 {It should reflect shortly.|Thanks for your patience.}',
      '{Hi|Hello} {{firstName}}, {refund processed|we\'ve refunded your payment} for {{orderNumber}}. {It may take a little time to show up.|Thank you for waiting.}',
      '{Update|Good news}: {the refund for {{orderNumber}} is processed|{{orderNumber}} refund is on its way back to you}.',
    ],
  },
]

export const EVENT_KEYS = WHATSAPP_EVENTS.map((e) => e.key)

export function getEventDefinition(key) {
  return WHATSAPP_EVENTS.find((e) => e.key === key) || null
}

export function getSampleVars() {
  return { ...SAMPLE_VARS }
}

// ─── spintax ────────────────────────────────────────────────────────────────

const VAR_OPEN = '\u0001'
const VAR_CLOSE = '\u0002'

/** Resolves `{a|b|c}` groups (innermost first). Variables `{{x}}` are left intact. */
export function resolveSpintax(text, rng = Math.random) {
  let out = String(text ?? '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, `${VAR_OPEN}$1${VAR_CLOSE}`)
  let guard = 0
  const re = /\{([^{}]*)\}/
  while (re.test(out) && guard++ < 200) {
    out = out.replace(re, (_, inner) => {
      const options = inner.split('|')
      return options[Math.floor(rng() * options.length)]
    })
  }
  return out.replace(new RegExp(`${VAR_OPEN}([a-zA-Z0-9_]+)${VAR_CLOSE}`, 'g'), '{{$1}}')
}

export function fillVariables(text, vars) {
  return String(text).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const value = vars?.[key]
    return value === undefined || value === null ? '' : String(value)
  })
}

/** Tidy the result of an empty variable: stray spaces, blank-line runs, orphan punctuation. */
export function tidyMessage(text) {
  return String(text)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([.,!?])/g, '$1')
    .replace(/(^|\n)[·•\-–,. ]+(?=\n|$)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** "1.00" → "1", "0.50" → "0.5" (quantities arrive as decimals from Postgres). */
export function formatQty(q) {
  const n = Number(q)
  return Number.isFinite(n) ? String(Number(n.toFixed(2))) : String(q)
}

/** Formats the item list in one of several natural styles. */
export function formatItems(items, rng = Math.random, max = 6) {
  const list = (items || []).filter((i) => i && i.name)
  if (!list.length) return ''
  const shown = list.slice(0, max)
  const extra = list.length - shown.length
  const style = Math.floor(rng() * 3)
  let text
  if (style === 0) {
    text = shown.map((i) => `• ${formatQty(i.quantity)} × ${i.name}`).join('\n')
  } else if (style === 1) {
    text = shown.map((i, n) => `${n + 1}. ${i.name} (x${formatQty(i.quantity)})`).join('\n')
  } else {
    text = shown.map((i) => `${i.name} ×${formatQty(i.quantity)}`).join(', ')
  }
  return extra > 0 ? `${text}${style === 2 ? ' ' : '\n'}+${extra} more` : text
}

export function formatRupees(amount) {
  const n = Number(amount)
  if (!Number.isFinite(n)) return ''
  const fixed = Number.isInteger(n) ? String(n) : n.toFixed(2)
  return `₹${fixed}`
}

/**
 * Picks a variant (never the same index as `lastIndex` when there is a choice)
 * and renders it. Re-rolls up to a few times so the text differs from `lastBody`.
 */
export function renderMessage(variants, vars, { lastIndex = -1, lastBody = null, rng = Math.random } = {}) {
  const pool = (variants || []).map((v) => String(v)).filter((v) => v.trim())
  if (!pool.length) return null

  let result = null
  for (let attempt = 0; attempt < 6; attempt++) {
    let index = Math.floor(rng() * pool.length)
    if (pool.length > 1 && index === lastIndex) index = (index + 1 + Math.floor(rng() * (pool.length - 1))) % pool.length
    const items = vars?.itemList
    const fullVars = { ...vars, items: vars?.items ?? formatItems(items, rng) }
    const body = tidyMessage(fillVariables(resolveSpintax(pool[index], rng), fullVars))
    result = { body, index }
    if (body && body !== lastBody) break
  }
  return result
}

/** How many distinct texts can a variant set produce? (rough, for the dashboard hint) */
export function countCombinations(variants) {
  let total = 0
  for (const v of variants || []) {
    let combos = 1
    let text = String(v).replace(/\{\{[^}]*\}\}/g, '')
    let guard = 0
    const re = /\{([^{}]*)\}/
    while (re.test(text) && guard++ < 200) {
      text = text.replace(re, (_, inner) => {
        combos *= inner.split('|').length
        return 'x'
      })
    }
    total += combos
  }
  return total
}
