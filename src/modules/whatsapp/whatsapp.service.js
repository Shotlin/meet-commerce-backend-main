import { logger } from '../../config/logger.js'
import { WhatsAppRepository } from './whatsapp.repository.js'
import { getWhatsAppManager } from './whatsapp.manager.js'
import {
  WHATSAPP_EVENTS,
  EVENT_KEYS,
  getEventDefinition,
  getSampleVars,
  renderMessage,
  formatItems,
  formatRupees,
  countCombinations,
  TEMPLATE_VARIABLES,
} from './whatsapp.templates.js'

const log = logger

const MESSAGE_MAX_AGE_MS = 6 * 60 * 60 * 1000
const MAX_ATTEMPTS = 3
const AUTO_PAUSE_AFTER_FAILURES = 5
const AUTO_PAUSE_MS = 30 * 60 * 1000

const randBetween = (min, max) => min + Math.random() * Math.max(0, max - min)

// ─── pure helpers (exported for tests) ──────────────────────────────────────

/** → digits with country code, or null when it can't be a real mobile number. */
export function normalizePhone(raw, countryCode = '91') {
  let digits = String(raw ?? '').replace(/\D/g, '')
  if (!digits) return null
  digits = digits.replace(/^0+/, '')
  if (digits.length === 10) digits = `${countryCode}${digits}`
  if (digits.length < 11 || digits.length > 15) return null
  return digits
}

/** Daily ceiling, ramped for a freshly linked number when warm-up is on. */
export function effectiveDailyCap(settings, now = new Date()) {
  const cap = Number(settings.daily_cap) || 0
  if (!settings.warmup_enabled || !settings.first_connected_at) return cap
  const days = Math.floor((now - new Date(settings.first_connected_at)) / 86_400_000)
  const ramp = days < 2 ? 20 : days < 4 ? 40 : days < 7 ? 80 : Infinity
  return Math.min(cap, ramp)
}

/** Quiet-hours check in India time. Start > end means the window wraps midnight. */
export function isQuietNow(settings, now = new Date()) {
  if (!settings.quiet_hours_enabled) return false
  const minutes = (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % 1440
  const { quiet_start_min: start, quiet_end_min: end } = settings
  return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end
}

export function buildTemplateVars(ctx) {
  const name = String(ctx.customer_name || '').trim()
  const firstName = name.split(/\s+/)[0] || 'there'
  const items = (ctx.items || []).map((i) => ({ name: i.name, quantity: i.quantity }))
  const walletPaid = Number(ctx.wallet_amount) || 0
  const total = Number(ctx.total_payable) || 0
  const paidOnline = ctx.payment_status === 'PAID'
  const paymentNote = paidOnline
    ? 'Paid online ✅'
    : walletPaid > 0
      ? `${formatRupees(Math.max(0, total - walletPaid))} to pay on delivery`
      : 'Pay cash on delivery'
  return {
    name: name || 'Customer',
    firstName,
    orderNumber: ctx.order_number,
    total: formatRupees(total),
    itemSummary: `${items.length} ${items.length === 1 ? 'item' : 'items'}`,
    itemList: items,
    shopName: ctx.shop_name || 'FreshCuts',
    paymentNote,
  }
}

// ─── service ────────────────────────────────────────────────────────────────

export class WhatsAppService {
  constructor(repo = new WhatsAppRepository(), manager = getWhatsAppManager()) {
    this.repo = repo
    this.manager = manager
    this.timer = null
    this.nextAllowedAt = 0
    this.consecutiveFailures = 0
    this.pausedUntil = 0
    this.ticking = false
    this.lastIndexByEvent = new Map()
  }

  async start() {
    await this.manager.start()
    this.timer = setInterval(() => { this.tick().catch((e) => log.error({ err: e.message }, 'WhatsApp tick failed')) }, 4000)
    this.timer.unref?.()
  }

  async stop() {
    clearInterval(this.timer)
    await this.manager.stop()
  }

  // ── dashboard views ──────────────────────────────────────────────────────
  async getOverview() {
    const [settings, stats] = await Promise.all([this.repo.getSettings({ fresh: true }), this.repo.stats()])
    return {
      connection: this.manager.getStatus(),
      settings: this._publicSettings(settings),
      stats,
      effectiveDailyCap: effectiveDailyCap(settings),
      quietNow: isQuietNow(settings),
      autoPausedUntil: this.pausedUntil > Date.now() ? new Date(this.pausedUntil).toISOString() : null,
    }
  }

  _publicSettings(s) {
    return {
      enabled: s.enabled,
      countryCode: s.country_code,
      sendDelayMinSec: s.send_delay_min_sec,
      sendDelayMaxSec: s.send_delay_max_sec,
      minGapSec: s.min_gap_sec,
      maxGapSec: s.max_gap_sec,
      typingSimulation: s.typing_simulation,
      hourlyCap: s.hourly_cap,
      dailyCap: s.daily_cap,
      warmupEnabled: s.warmup_enabled,
      quietHoursEnabled: s.quiet_hours_enabled,
      quietStartMin: s.quiet_start_min,
      quietEndMin: s.quiet_end_min,
      connectedPhone: s.connected_phone,
      connectedName: s.connected_name,
      firstConnectedAt: s.first_connected_at,
      lastConnectedAt: s.last_connected_at,
    }
  }

  async saveSettings(patch, adminId) {
    const current = await this.repo.getSettings({ fresh: true })
    const next = { ...this._publicSettings(current), ...patch }
    if (next.sendDelayMinSec > next.sendDelayMaxSec) throw this._bad('Minimum delay cannot be above the maximum delay')
    if (next.minGapSec > next.maxGapSec) throw this._bad('Minimum gap cannot be above the maximum gap')
    if (next.hourlyCap > next.dailyCap) throw this._bad('Hourly limit cannot be above the daily limit')
    const saved = await this.repo.updateSettings(patch, adminId)
    return this._publicSettings(saved)
  }

  _bad(message) {
    return Object.assign(new Error(message), { statusCode: 400, code: 'VALIDATION_ERROR' })
  }

  // ── events / templates ───────────────────────────────────────────────────
  async listEvents() {
    const overrides = await this.repo.listEventOverrides()
    return {
      variables: TEMPLATE_VARIABLES,
      events: WHATSAPP_EVENTS.map((def) => this._mergeEvent(def, overrides.get(def.key))),
    }
  }

  _mergeEvent(def, override) {
    const variants = override?.variants?.length ? override.variants : def.defaultVariants
    return {
      key: def.key,
      label: def.label,
      hint: def.hint,
      enabled: override ? override.enabled : def.defaultEnabled,
      variants,
      customized: !!override,
      defaultVariants: def.defaultVariants,
      combinations: countCombinations(variants),
    }
  }

  async saveEvent(key, { enabled, variants }) {
    const def = getEventDefinition(key)
    if (!def) throw Object.assign(new Error('Unknown event'), { statusCode: 404, code: 'NOT_FOUND' })
    const clean = (variants || []).map((v) => String(v).trim()).filter(Boolean)
    if (!clean.length) throw this._bad('Add at least one message variant')
    if (clean.length > 12) throw this._bad('Use at most 12 variants per event')
    if (clean.some((v) => v.length > 1000)) throw this._bad('A variant is too long (max 1000 characters)')
    const open = (s) => (s.match(/\{/g) || []).length
    const close = (s) => (s.match(/\}/g) || []).length
    if (clean.some((v) => open(v) !== close(v))) throw this._bad('A variant has unbalanced { } brackets')
    await this.repo.upsertEvent(key, { enabled: !!enabled, variants: clean })
    return this._mergeEvent(def, { enabled: !!enabled, variants: clean })
  }

  async resetEvent(key) {
    const def = getEventDefinition(key)
    if (!def) throw Object.assign(new Error('Unknown event'), { statusCode: 404, code: 'NOT_FOUND' })
    await this.repo.deleteEventOverride(key)
    return this._mergeEvent(def, null)
  }

  /** Renders sample messages so the admin can see the variety before enabling. */
  preview(key, variants, count = 5) {
    const def = getEventDefinition(key)
    if (!def) throw Object.assign(new Error('Unknown event'), { statusCode: 404, code: 'NOT_FOUND' })
    const pool = variants?.length ? variants : def.defaultVariants
    const out = []
    let last = { lastIndex: -1, lastBody: null }
    const vars = getSampleVars()
    for (let i = 0; i < count; i++) {
      const r = renderMessage(pool, vars, last)
      out.push(r.body)
      last = { lastIndex: r.index, lastBody: r.body }
    }
    return out
  }

  // ── enqueue ──────────────────────────────────────────────────────────────
  async enqueueOrderEvent(orderId, eventKey) {
    if (!EVENT_KEYS.includes(eventKey)) return { queued: false, reason: 'EVENT_NOT_SUPPORTED' }
    const settings = await this.repo.getSettings()
    if (!settings?.enabled) return { queued: false, reason: 'DISABLED' }

    const ctx = await this.repo.getOrderContext(orderId)
    if (!ctx) return { queued: false, reason: 'ORDER_NOT_FOUND' }

    let key = eventKey
    if (eventKey === 'ORDER_PLACED') {
      if (await this.repo.hasMessageForOrder(orderId, ['ORDER_PLACED', 'FIRST_ORDER'])) {
        return { queued: false, reason: 'ALREADY_QUEUED' }
      }
      if ((await this.repo.countPriorOrders(ctx.customer_id, orderId)) === 0) key = 'FIRST_ORDER'
    }

    const overrides = await this.repo.listEventOverrides()
    let event = this._mergeEvent(getEventDefinition(key), overrides.get(key))
    // FIRST_ORDER disabled → the customer still gets the normal confirmation.
    if (key === 'FIRST_ORDER' && !event.enabled) {
      key = 'ORDER_PLACED'
      event = this._mergeEvent(getEventDefinition(key), overrides.get(key))
    }
    if (!event.enabled) return { queued: false, reason: 'EVENT_OFF' }

    const phone = normalizePhone(ctx.customer_phone, settings.country_code)
    if (!phone) {
      await this.repo.insertSkipped({ orderId, userId: ctx.customer_id, phone: ctx.customer_phone, eventKey: key, reason: 'INVALID_PHONE' })
      return { queued: false, reason: 'INVALID_PHONE' }
    }
    if (await this.repo.isOptedOut(phone)) {
      await this.repo.insertSkipped({ orderId, userId: ctx.customer_id, phone, eventKey: key, reason: 'OPTED_OUT' })
      return { queued: false, reason: 'OPTED_OUT' }
    }

    const vars = buildTemplateVars(ctx)
    vars.items = formatItems(vars.itemList)
    const rendered = renderMessage(event.variants, vars, {
      lastIndex: this.lastIndexByEvent.get(key) ?? -1,
      lastBody: await this.repo.lastSentBodyForEvent(key),
    })
    if (!rendered?.body) return { queued: false, reason: 'EMPTY_MESSAGE' }
    this.lastIndexByEvent.set(key, rendered.index)

    const delaySec = randBetween(settings.send_delay_min_sec, settings.send_delay_max_sec)
    const row = await this.repo.enqueue({
      orderId, userId: ctx.customer_id, phone, eventKey: key, body: rendered.body,
      scheduledAt: new Date(Date.now() + delaySec * 1000),
    })
    return row ? { queued: true, id: row.id, eventKey: key } : { queued: false, reason: 'ALREADY_QUEUED' }
  }

  /** Test message to any number, using a sample rendering of the chosen event. */
  async sendTest({ phone, eventKey = 'ORDER_PLACED', variants }) {
    const settings = await this.repo.getSettings({ fresh: true })
    const normalized = normalizePhone(phone, settings.country_code)
    if (!normalized) throw this._bad('Enter a valid mobile number')
    const [body] = this.preview(eventKey, variants, 1)
    const row = await this.repo.enqueue({ phone: normalized, eventKey: 'TEST', body, scheduledAt: new Date() })
    return { id: row.id, body }
  }

  // ── sender loop ──────────────────────────────────────────────────────────
  async tick(now = Date.now()) {
    if (this.ticking) return
    this.ticking = true
    try {
      if (this.manager.getStatus().state !== 'CONNECTED') return
      if (now < this.nextAllowedAt || now < this.pausedUntil) return
      const settings = await this.repo.getSettings()
      if (!settings?.enabled) return
      if (isQuietNow(settings, new Date(now))) return

      const [hour, day] = await Promise.all([this.repo.countSentSince('1 hour'), this.repo.countSentSince('24 hours')])
      if (hour >= settings.hourly_cap || day >= effectiveDailyCap(settings, new Date(now))) return

      const msg = await this.repo.claimNext()
      if (!msg) return

      if (now - new Date(msg.scheduled_at).getTime() > MESSAGE_MAX_AGE_MS) {
        await this.repo.markSkipped(msg.id, 'EXPIRED')
        return
      }
      if (await this.repo.isOptedOut(msg.phone)) {
        await this.repo.markSkipped(msg.id, 'OPTED_OUT')
        return
      }

      try {
        const { messageId } = await this.manager.sendText(msg.phone, msg.body, { typing: settings.typing_simulation })
        await this.repo.markSent(msg.id, messageId)
        this.consecutiveFailures = 0
      } catch (err) {
        if (err.code === 'NOT_ON_WHATSAPP') {
          await this.repo.markSkipped(msg.id, 'NOT_ON_WHATSAPP')
        } else if (err.code === 'NOT_CONNECTED') {
          await this.repo.requeue(msg.id, err.message, 60)
        } else {
          this.consecutiveFailures += 1
          if (msg.attempts >= MAX_ATTEMPTS) await this.repo.markFailed(msg.id, err.message)
          else await this.repo.requeue(msg.id, err.message, 120 * msg.attempts)
          if (this.consecutiveFailures >= AUTO_PAUSE_AFTER_FAILURES) {
            this.pausedUntil = Date.now() + AUTO_PAUSE_MS
            this.consecutiveFailures = 0
            log.error('WhatsApp sending auto-paused for 30 minutes after repeated failures')
          }
        }
      }
      this.nextAllowedAt = Date.now() + randBetween(settings.min_gap_sec, settings.max_gap_sec) * 1000
    } finally {
      this.ticking = false
    }
  }

  async listMessages(opts) {
    return this.repo.listMessages(opts)
  }

  async removeOptOut(phone) {
    const settings = await this.repo.getSettings()
    const normalized = normalizePhone(phone, settings.country_code)
    if (!normalized) throw this._bad('Enter a valid mobile number')
    await this.repo.removeOptOut(normalized)
  }
}

let instance = null
export function getWhatsAppService() {
  if (!instance) instance = new WhatsAppService()
  return instance
}

/** Fire-and-forget hook for order code. Never throws, never blocks the caller. */
export function notifyOrderWhatsApp(orderId, eventKey) {
  if (!orderId) return
  getWhatsAppService()
    .enqueueOrderEvent(orderId, eventKey)
    .catch((err) => log.warn({ err: err.message, orderId, eventKey }, 'WhatsApp enqueue failed (non-critical)'))
}
