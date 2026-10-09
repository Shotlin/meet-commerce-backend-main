import { describe, it, expect } from 'vitest'
import {
  resolveSpintax,
  fillVariables,
  tidyMessage,
  renderMessage,
  formatItems,
  countCombinations,
  WHATSAPP_EVENTS,
  getSampleVars,
} from '../../../src/modules/whatsapp/whatsapp.templates.js'
import {
  normalizePhone,
  effectiveDailyCap,
  isQuietNow,
  buildTemplateVars,
} from '../../../src/modules/whatsapp/whatsapp.service.js'

const seeded = (seq) => { let i = 0; return () => seq[i++ % seq.length] }

describe('spintax', () => {
  it('picks one option and leaves {{variables}} alone', () => {
    expect(resolveSpintax('{Hi|Hello} {{name}}', seeded([0.9]))).toBe('Hello {{name}}')
    expect(resolveSpintax('{Hi|Hello} {{name}}', seeded([0]))).toBe('Hi {{name}}')
  })
  it('resolves nested groups and empty options', () => {
    expect(resolveSpintax('a{ b|}c', seeded([0.9]))).toBe('ac')
    expect(resolveSpintax('{x {1|2}|y}', seeded([0.9, 0]))).toBe('x 2')
  })
  it('a variable inside a group is preserved', () => {
    expect(resolveSpintax('{the refund for {{orderNumber}} is done|ok}', seeded([0]))).toBe('the refund for {{orderNumber}} is done')
  })
})

describe('rendering', () => {
  it('never reuses the previous variant when there is a choice', () => {
    const variants = ['A {{name}}', 'B {{name}}', 'C {{name}}']
    for (let i = 0; i < 50; i++) {
      const r = renderMessage(variants, { name: 'x' }, { lastIndex: 1 })
      expect(r.index).not.toBe(1)
    }
  })
  it('re-rolls so the text differs from the last one', () => {
    const r = renderMessage(['{one|two}'], {}, { lastBody: 'one', rng: seeded([0, 0.9]) })
    expect(r.body).toBe('two')
  })
  it('drops empty variables cleanly', () => {
    expect(tidyMessage(fillVariables('Hi {{x}} , bye  !', {}))).toBe('Hi, bye!')
  })
  it('every built-in event renders non-empty with no leftover braces, many times', () => {
    const vars = { ...getSampleVars(), itemList: [{ name: 'Chicken', quantity: 1 }] }
    for (const ev of WHATSAPP_EVENTS) {
      expect(ev.defaultVariants.length).toBeGreaterThanOrEqual(3)
      const seen = new Set()
      for (let i = 0; i < 60; i++) {
        const r = renderMessage(ev.defaultVariants, vars)
        expect(r.body.length).toBeGreaterThan(10)
        expect(r.body).not.toMatch(/[{}\u0001\u0002]/)
        expect(r.body).toContain('FC-KOL')
        seen.add(r.body)
      }
      expect(seen.size).toBeGreaterThan(5)
    }
  })
  it('order confirmation offers a lot of distinct texts', () => {
    const ev = WHATSAPP_EVENTS.find((e) => e.key === 'ORDER_PLACED')
    expect(countCombinations(ev.defaultVariants)).toBeGreaterThan(100)
  })
})

describe('formatItems', () => {
  it('caps the list and reports the remainder', () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ name: `P${i}`, quantity: 1 }))
    expect(formatItems(items, () => 0)).toContain('+3 more')
  })
  it('is empty for no items', () => {
    expect(formatItems([])).toBe('')
  })
})

describe('phone + pacing helpers', () => {
  it('normalizes Indian numbers', () => {
    expect(normalizePhone('98123 45678')).toBe('919812345678')
    expect(normalizePhone('+91 98123-45678')).toBe('919812345678')
    expect(normalizePhone('09812345678')).toBe('919812345678')
    expect(normalizePhone('12345')).toBeNull()
    expect(normalizePhone('')).toBeNull()
  })
  it('warm-up ramps the daily cap for a new number', () => {
    const s = { daily_cap: 150, warmup_enabled: true, first_connected_at: new Date('2026-10-01T00:00:00Z') }
    expect(effectiveDailyCap(s, new Date('2026-10-01T10:00:00Z'))).toBe(20)
    expect(effectiveDailyCap(s, new Date('2026-10-03T10:00:00Z'))).toBe(40)
    expect(effectiveDailyCap(s, new Date('2026-10-06T10:00:00Z'))).toBe(80)
    expect(effectiveDailyCap(s, new Date('2026-10-20T10:00:00Z'))).toBe(150)
    expect(effectiveDailyCap({ ...s, warmup_enabled: false }, new Date('2026-10-01T10:00:00Z'))).toBe(150)
  })
  it('quiet hours wrap midnight in IST', () => {
    const s = { quiet_hours_enabled: true, quiet_start_min: 1320, quiet_end_min: 480 } // 22:00-08:00 IST
    expect(isQuietNow(s, new Date('2026-10-01T17:00:00Z'))).toBe(true) // 22:30 IST
    expect(isQuietNow(s, new Date('2026-10-01T02:00:00Z'))).toBe(true) // 07:30 IST
    expect(isQuietNow(s, new Date('2026-10-01T06:00:00Z'))).toBe(false) // 11:30 IST
    expect(isQuietNow({ ...s, quiet_hours_enabled: false }, new Date('2026-10-01T17:00:00Z'))).toBe(false)
  })
  it('builds variables from an order', () => {
    const v = buildTemplateVars({
      customer_name: 'Rahul Sharma', order_number: 'FC-1', total_payable: '380.00', payment_status: 'PENDING',
      wallet_amount: '0', shop_name: 'FreshCuts Kolkata', items: [{ name: 'Eggs', quantity: 2 }],
    })
    expect(v).toMatchObject({ firstName: 'Rahul', total: '₹380', itemSummary: '1 item', paymentNote: 'Pay cash on delivery' })
    expect(buildTemplateVars({ customer_name: '', order_number: 'x', total_payable: 10, payment_status: 'PAID', items: [] }).paymentNote).toBe('Paid online ✅')
  })
})
