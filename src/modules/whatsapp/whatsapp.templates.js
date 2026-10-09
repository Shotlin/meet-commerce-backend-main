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
  { key: 'itemLine', desc: 'One short line, e.g. "Chicken Breast (1 kg) and 2 more"' },
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
  itemLine: 'Chicken Breast Boneless (500 g) and 1 more',
  shopName: 'FreshCuts Kolkata',
  paymentNote: 'pay on delivery',
}

export const WHATSAPP_EVENTS = [
  {
    key: 'FIRST_ORDER',
    label: 'First order (new customer)',
    hint: 'Sent instead of "Order placed" for a customer\'s very first order. Asks them to save the number (a saved contact is the best protection for the number).',
    defaultEnabled: true,
    defaultVariants: [
      '{Hi|Hello|Hey} {{firstName}}, got your order {{orderNumber}} 👍 {{itemLine}}, {{total}} – {{paymentNote}}.\n\n{This is our order-updates number, save it so you don\'t miss anything.|Do save this number, all updates will come here.}',
      '{{firstName}}, thanks for ordering with us! Order {{orderNumber}} is in. {{itemLine}}.\n{Please save this number so our updates reach you.|Save this number for delivery updates.} {Reply here if anything needs changing.|Message us here if you want to change something.}',
      '{Namaste|Hello} {{firstName}} 🙏 your first order ({{orderNumber}}) is confirmed. {{total}}, {{paymentNote}}.\n{|{{items}}\n}{Save this number for updates 🙂|We\'ll text you here when it\'s out for delivery.}',
      'Hi {{firstName}}! Order {{orderNumber}} received, {{itemSummary}} for {{total}}. {Save this number, updates will come here.|We\'ll update you here.} {Reply \'ok\' if the address and items look right.|Just reply here if anything is wrong.}',
    ],
  },
  {
    key: 'ORDER_PLACED',
    label: 'Order placed / confirmed',
    hint: 'The confirmation sent right after an order is placed (or paid online). Tip: a line that invites a reply builds trust for the number. Remove {{items}} / {{itemLine}} from a version to leave the items out.',
    defaultEnabled: true,
    defaultVariants: [
      '{Hi|Hello|Hey} {{firstName}}, order {{orderNumber}} is confirmed 👍 {{itemLine}}, {{total}}. {{paymentNote}}.{||| Reply if you want to change anything.}{||||\n\nReply STOP to stop these messages.}',
      '{{firstName}}, we\'ve got your order! {{orderNumber}} – {{itemSummary}}, {{total}}.\n{We\'ll let you know when it leaves the store.|You\'ll get an update here once it\'s on the way.}',
      'Thanks {{firstName}} 🙏 {{itemLine}} is booked ({{orderNumber}}). {{paymentNote}}, {{total}}. {Reply \'ok\' if the address is right.|Tell us here if anything looks off.}',
      '{Hi|Hello} {{firstName}}, {your order is in|order received}: {{orderNumber}}.\n{{items}}\n{{total}} – {{paymentNote}}.{||| We\'ll update you soon.}',
      '{{firstName}}, {all good|done} ✅ {{orderNumber}} is confirmed. {{itemLine}}. {{paymentNote}}.{||\n\nReply STOP to stop these messages.}',
      '{Order|Booking} {{orderNumber}} {confirmed|is in} {🙂|👍|✅} {Hi|Hello} {{firstName}}, {we\'ll start packing now|the store has it}. {{total}}, {{paymentNote}}.{||| Reply if the address is wrong.}',
      '{{firstName}}, {thank you|thanks} for ordering {🙏|}. {{itemSummary}} – {{itemLine}}.\n{{total}} · {{paymentNote}} · {{orderNumber}}\n{{Will keep you posted here.|You\'ll get updates on this chat.}|}',
    ],
  },
  {
    key: 'CONFIRMED',
    label: 'Order accepted by store',
    hint: 'The store accepted the order. Off by default — it can feel repetitive right after the confirmation.',
    defaultEnabled: false,
    defaultVariants: [
      '{{firstName}}, the store has accepted order {{orderNumber}} 👍 {Packing it now.|Getting it ready.}',
      '{Hi|Hello} {{firstName}}, {{orderNumber}} is accepted. {We\'re on it.|Will update you soon.}',
      'Update on {{orderNumber}}: accepted by the store, being prepared {🙂|}',
    ],
  },
  {
    key: 'PACKED',
    label: 'Order packed',
    hint: 'Packed and waiting for the delivery partner. Off by default.',
    defaultEnabled: false,
    defaultVariants: [
      '{{firstName}}, {{orderNumber}} is packed 📦 {Rider pickup is next.|It will leave shortly.}',
      '{Hi|Hello} {{firstName}}, packing done for {{orderNumber}}. {Out for delivery soon.|On its way shortly.}',
      '{{orderNumber}} is packed and ready {🙂|}{ {{firstName}}|}',
    ],
  },
  {
    key: 'PICKED_UP',
    label: 'Out for delivery',
    hint: 'The rider picked up the order. (The delivery OTP is never sent over WhatsApp.)',
    defaultEnabled: false,
    defaultVariants: [
      '{{firstName}}, your order {{orderNumber}} is on its way 🛵 {Please keep your phone nearby.|Please be reachable on call.}',
      '{Out for delivery|On the way} {{firstName}} – {{orderNumber}}. {The delivery code is in the app.|You\'ll find the delivery code in the app.}',
      '{Hi|Hello} {{firstName}}, the rider has left with {{orderNumber}} {🛵|}. {See you soon!|Almost there.}',
    ],
  },
  {
    key: 'DELIVERED',
    label: 'Delivered',
    hint: 'Order delivered. Off by default.',
    defaultEnabled: false,
    defaultVariants: [
      '{{firstName}}, {{orderNumber}} is delivered ✅ {Hope you like it!|Enjoy!} {Tell us here if anything\'s not right.|Message us if there\'s any issue.}',
      '{Delivered|All done} – {{orderNumber}}. {Thanks {{firstName}}!|Thank you {{firstName}} 🙏} {Reply here if something is wrong.|Do tell us how it was.}',
      '{Hi|Hello} {{firstName}}, your order reached you ({{orderNumber}}). {Hope everything is fresh!|Hope all is good.}',
    ],
  },
  {
    key: 'CANCELLED',
    label: 'Order cancelled',
    hint: 'Order cancelled (by customer, store or system).',
    defaultEnabled: false,
    defaultVariants: [
      '{{firstName}}, order {{orderNumber}} has been cancelled. {If you paid online, the money goes back to you automatically.|Any online payment will be refunded.}',
      '{Hi|Hello} {{firstName}}, {{orderNumber}} is cancelled. {Sorry for the trouble – reply here if you need help.|Message us here if you have questions.}',
      'Update: {{orderNumber}} is now cancelled. {Refunds, if any, are processed automatically.|Hope to serve you again soon.}',
    ],
  },
  {
    key: 'REFUNDED',
    label: 'Refund processed',
    hint: 'A refund was issued for the order.',
    defaultEnabled: false,
    defaultVariants: [
      '{{firstName}}, your refund for {{orderNumber}} is done 💰 {It can take a little while to show up.|It should reflect shortly.}',
      '{Hi|Hello} {{firstName}}, we\'ve refunded {{orderNumber}}. {Thanks for your patience.|Let us know if it doesn\'t show up.}',
      'Refund processed for {{orderNumber}}. {Thank you {{firstName}}.|Sorry again for the trouble.}',
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

/** "Name" / "Name and 2 more" — one natural line instead of a list. */
export function formatItemLine(items) {
  const list = (items || []).filter((i) => i && i.name)
  if (!list.length) return 'your items'
  return list.length === 1 ? list[0].name : `${list[0].name} and ${list.length - 1} more`
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
    const fullVars = { ...vars, items: vars?.items ?? formatItems(items, rng), itemLine: vars?.itemLine ?? formatItemLine(items) }
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
