import { query } from '../../config/database.js'

const SETTINGS_COLUMNS = `
  id, enabled, country_code, send_delay_min_sec, send_delay_max_sec, min_gap_sec, max_gap_sec,
  typing_simulation, hourly_cap, daily_cap, warmup_enabled, quiet_hours_enabled,
  quiet_start_min, quiet_end_min, chat_retention_days, connected_phone, connected_name,
  first_connected_at, last_connected_at, updated_at`

const SETTINGS_FIELD_MAP = {
  enabled: 'enabled',
  countryCode: 'country_code',
  sendDelayMinSec: 'send_delay_min_sec',
  sendDelayMaxSec: 'send_delay_max_sec',
  minGapSec: 'min_gap_sec',
  maxGapSec: 'max_gap_sec',
  typingSimulation: 'typing_simulation',
  hourlyCap: 'hourly_cap',
  dailyCap: 'daily_cap',
  warmupEnabled: 'warmup_enabled',
  quietHoursEnabled: 'quiet_hours_enabled',
  quietStartMin: 'quiet_start_min',
  quietEndMin: 'quiet_end_min',
  chatRetentionDays: 'chat_retention_days',
}

let settingsCache = { value: null, expiresAt: 0 }

export class WhatsAppRepository {
  // ─── settings ────────────────────────────────────────────────────────────
  async getSettings({ fresh = false } = {}) {
    const now = Date.now()
    if (!fresh && settingsCache.value && now < settingsCache.expiresAt) return settingsCache.value
    const { rows } = await query(`SELECT ${SETTINGS_COLUMNS} FROM whatsapp_settings WHERE singleton = TRUE`)
    settingsCache = { value: rows[0] || null, expiresAt: now + 10_000 }
    return rows[0] || null
  }

  async updateSettings(patch, updatedBy = null) {
    const sets = []
    const params = []
    for (const [key, column] of Object.entries(SETTINGS_FIELD_MAP)) {
      if (patch[key] === undefined) continue
      params.push(patch[key])
      sets.push(`${column} = $${params.length}`)
    }
    if (!sets.length) return this.getSettings({ fresh: true })
    params.push(updatedBy)
    sets.push(`updated_by = $${params.length}`, 'updated_at = NOW()')
    await query(`UPDATE whatsapp_settings SET ${sets.join(', ')} WHERE singleton = TRUE`, params)
    settingsCache = { value: null, expiresAt: 0 }
    return this.getSettings({ fresh: true })
  }

  async markConnected({ phone, name }) {
    await query(
      `UPDATE whatsapp_settings
          SET connected_phone = $1, connected_name = $2,
              first_connected_at = COALESCE(first_connected_at, NOW()),
              last_connected_at = NOW(), updated_at = NOW()
        WHERE singleton = TRUE`,
      [phone, name || null]
    )
    settingsCache = { value: null, expiresAt: 0 }
  }

  async clearConnection() {
    await query(
      `UPDATE whatsapp_settings
          SET connected_phone = NULL, connected_name = NULL, first_connected_at = NULL, updated_at = NOW()
        WHERE singleton = TRUE`
    )
    settingsCache = { value: null, expiresAt: 0 }
  }

  // ─── event templates (overrides) ─────────────────────────────────────────
  async listEventOverrides() {
    const { rows } = await query('SELECT event_key, enabled, variants FROM whatsapp_event_templates')
    return new Map(rows.map((r) => [r.event_key, r]))
  }

  async upsertEvent(eventKey, { enabled, variants }) {
    await query(
      `INSERT INTO whatsapp_event_templates (event_key, enabled, variants, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (event_key) DO UPDATE
         SET enabled = EXCLUDED.enabled, variants = EXCLUDED.variants, updated_at = NOW()`,
      [eventKey, enabled, JSON.stringify(variants)]
    )
  }

  async deleteEventOverride(eventKey) {
    await query('DELETE FROM whatsapp_event_templates WHERE event_key = $1', [eventKey])
  }

  // ─── order context for variables ─────────────────────────────────────────
  async getOrderContext(orderId) {
    const { rows } = await query(
      `SELECT o.id, o.order_number, o.customer_id, o.total_payable, o.payment_method, o.payment_status,
              o.wallet_amount, u.name AS customer_name, u.phone AS customer_phone, s.name AS shop_name
         FROM orders o
         JOIN users u ON u.id = o.customer_id
         LEFT JOIN shops s ON s.id = o.shop_id
        WHERE o.id = $1`,
      [orderId]
    )
    if (!rows[0]) return null
    const items = await query(
      'SELECT product_name AS name, quantity FROM order_items WHERE order_id = $1 ORDER BY created_at NULLS LAST, id',
      [orderId]
    )
    return { ...rows[0], items: items.rows }
  }

  async countPriorOrders(customerId, orderId) {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM orders
        WHERE customer_id = $1 AND id <> $2 AND status <> 'CANCELLED'`,
      [customerId, orderId]
    )
    return rows[0]?.n || 0
  }

  // ─── message queue / log ─────────────────────────────────────────────────
  /** Returns the inserted row, or null if (order,event) was already queued. */
  async enqueue({ orderId = null, userId = null, phone, eventKey, body, scheduledAt }) {
    const { rows } = await query(
      `INSERT INTO whatsapp_messages (order_id, user_id, phone, event_key, body, scheduled_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [orderId, userId, phone, eventKey, body, scheduledAt]
    )
    return rows[0] || null
  }

  async hasMessageForOrder(orderId, eventKeys) {
    const { rows } = await query(
      'SELECT 1 FROM whatsapp_messages WHERE order_id = $1 AND event_key = ANY($2::text[]) LIMIT 1',
      [orderId, eventKeys]
    )
    return rows.length > 0
  }

  async insertSkipped({ orderId = null, userId = null, phone, eventKey, body = '', reason }) {
    const { rows } = await query(
      `INSERT INTO whatsapp_messages (order_id, user_id, phone, event_key, body, status, skip_reason)
       VALUES ($1, $2, $3, $4, $5, 'SKIPPED', $6)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [orderId, userId, phone || '', eventKey, body, reason]
    )
    return rows[0] || null
  }

  /** Atomically claims the oldest due message. */
  async claimNext() {
    const { rows } = await query(
      `UPDATE whatsapp_messages SET status = 'SENDING', attempts = attempts + 1
        WHERE id = (
          SELECT id FROM whatsapp_messages
           WHERE status = 'QUEUED' AND scheduled_at <= NOW()
           ORDER BY scheduled_at LIMIT 1
           FOR UPDATE SKIP LOCKED)
        RETURNING *`
    )
    return rows[0] || null
  }

  async markSent(id, waMessageId) {
    await query(
      `UPDATE whatsapp_messages SET status = 'SENT', wa_message_id = $2, sent_at = NOW(), error = NULL WHERE id = $1`,
      [id, waMessageId || null]
    )
  }

  async markSkipped(id, reason) {
    await query(`UPDATE whatsapp_messages SET status = 'SKIPPED', skip_reason = $2 WHERE id = $1`, [id, reason])
  }

  async markFailed(id, error) {
    await query(`UPDATE whatsapp_messages SET status = 'FAILED', error = $2 WHERE id = $1`, [id, String(error).slice(0, 500)])
  }

  async requeue(id, error, delaySec) {
    await query(
      `UPDATE whatsapp_messages
          SET status = 'QUEUED', error = $2, scheduled_at = NOW() + ($3 || ' seconds')::interval
        WHERE id = $1`,
      [id, String(error).slice(0, 500), String(delaySec)]
    )
  }

  /** On boot: anything left SENDING by a crashed process goes back to the queue. */
  async resetStuck() {
    await query(`UPDATE whatsapp_messages SET status = 'QUEUED' WHERE status = 'SENDING'`)
  }

  async countSentSince(interval) {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM whatsapp_messages WHERE status = 'SENT' AND sent_at > NOW() - $1::interval`,
      [interval]
    )
    return rows[0].n
  }

  async lastSentBodyForEvent(eventKey) {
    const { rows } = await query(
      `SELECT body FROM whatsapp_messages WHERE event_key = $1 AND status IN ('SENT','QUEUED') ORDER BY created_at DESC LIMIT 1`,
      [eventKey]
    )
    return rows[0]?.body || null
  }

  async listMessages({ limit = 50, offset = 0, status } = {}) {
    const params = [limit, offset]
    let where = ''
    if (status) {
      params.push(status)
      where = `WHERE status = $3`
    }
    const { rows } = await query(
      `SELECT id, order_id, phone, event_key, body, status, skip_reason, error, attempts, scheduled_at, sent_at, created_at
         FROM whatsapp_messages ${where} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      params
    )
    const total = await query(`SELECT COUNT(*)::int AS n FROM whatsapp_messages ${status ? 'WHERE status = $1' : ''}`, status ? [status] : [])
    return { rows, total: total.rows[0].n }
  }

  async stats() {
    const { rows } = await query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'SENT' AND sent_at > NOW() - INTERVAL '24 hours')::int AS sent_24h,
         COUNT(*) FILTER (WHERE status = 'SENT' AND sent_at > NOW() - INTERVAL '1 hour')::int AS sent_1h,
         COUNT(*) FILTER (WHERE status = 'QUEUED')::int AS queued,
         COUNT(*) FILTER (WHERE status = 'FAILED' AND created_at > NOW() - INTERVAL '24 hours')::int AS failed_24h,
         COUNT(*) FILTER (WHERE status = 'SKIPPED' AND created_at > NOW() - INTERVAL '24 hours')::int AS skipped_24h
       FROM whatsapp_messages`
    )
    return rows[0]
  }

  // ─── opt-outs ────────────────────────────────────────────────────────────
  async isOptedOut(phone) {
    const { rows } = await query('SELECT 1 FROM whatsapp_opt_outs WHERE phone = $1', [phone])
    return rows.length > 0
  }

  async addOptOut(phone) {
    await query('INSERT INTO whatsapp_opt_outs (phone) VALUES ($1) ON CONFLICT DO NOTHING', [phone])
    // Anything still waiting for this customer is dropped.
    await query(
      `UPDATE whatsapp_messages SET status = 'SKIPPED', skip_reason = 'OPTED_OUT'
        WHERE phone = $1 AND status = 'QUEUED'`,
      [phone]
    )
  }

  async removeOptOut(phone) {
    await query('DELETE FROM whatsapp_opt_outs WHERE phone = $1', [phone])
  }

  // ─── Baileys auth state ──────────────────────────────────────────────────
  async authGet(id) {
    const { rows } = await query('SELECT value FROM whatsapp_auth_state WHERE id = $1', [id])
    return rows[0]?.value ?? null
  }

  async authSet(id, value) {
    await query(
      `INSERT INTO whatsapp_auth_state (id, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [id, value]
    )
  }

  async authDelete(id) {
    await query('DELETE FROM whatsapp_auth_state WHERE id = $1', [id])
  }

  async authClear() {
    await query('DELETE FROM whatsapp_auth_state')
  }

  async hasAuthCreds() {
    const { rows } = await query(`SELECT 1 FROM whatsapp_auth_state WHERE id = 'creds'`)
    return rows.length > 0
  }
}
