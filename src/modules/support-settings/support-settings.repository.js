import { query } from '../../config/database.js'

/**
 * Support settings repository — the single GLOBAL row in
 * `support_settings` (migration 131), the one source of truth for brand
 * name / support phone / support email across the dashboard (admin
 * read+write) and the mobile app (public read-only). A short in-memory
 * cache keeps the mobile app's frequent "Need Help" sheet opens off the
 * DB; `invalidate()` (called by `save`) clears it immediately so a
 * dashboard save takes effect on the very next request — module-scoped, so
 * every import of this class shares one copy, matching the same pattern
 * `ola-maps-settings.repository.js` already uses.
 */

const CACHE_TTL_MS = 30_000

let cache = { value: undefined, expiresAt: 0 }

const COLUMNS = `id, brand_name, support_phone, support_email, created_at, updated_at, updated_by`

const UPDATABLE_COLUMNS = ['brand_name', 'support_phone', 'support_email']

export class SupportSettingsRepository {
  /** The single settings row, served from cache when fresh. */
  async get() {
    const now = Date.now()
    if (cache.value !== undefined && now < cache.expiresAt) {
      return cache.value
    }
    const { rows } = await query(`SELECT ${COLUMNS} FROM support_settings LIMIT 1`)
    const row = rows[0] || null
    cache = { value: row, expiresAt: now + CACHE_TTL_MS }
    return row
  }

  /** Partial update — only the keys present in `data` are touched. Always invalidates the cache. */
  async save(data, updatedBy = null) {
    const fields = []
    const params = []
    let idx = 1

    for (const key of UPDATABLE_COLUMNS) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        fields.push(`${key} = $${idx++}`)
        params.push(data[key])
      }
    }

    fields.push(`updated_by = $${idx++}`)
    params.push(updatedBy)
    fields.push('updated_at = NOW()')

    const { rows } = await query(
      `UPDATE support_settings SET ${fields.join(', ')} RETURNING ${COLUMNS}`,
      params
    )
    this.invalidate()
    return rows[0] || null
  }

  invalidate() {
    cache = { value: undefined, expiresAt: 0 }
  }
}
