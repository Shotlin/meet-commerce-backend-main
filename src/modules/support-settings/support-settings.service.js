import { SupportSettingsRepository } from './support-settings.repository.js'

// Loose on purpose — real support numbers vary in formatting (spaces,
// dashes, a leading +country code) and this only needs to reject obvious
// garbage, not enforce one specific national format.
const PHONE_RE = /^[+]?[\d\s\-().]{7,20}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export class SupportSettingsService {
  constructor(repository = new SupportSettingsRepository()) {
    this.repository = repository
  }

  /**
   * Public, unauthenticated view for the mobile app — brand name always
   * has a value (defaults to 'FreshCuts'), phone/email are `null` when
   * genuinely unconfigured so the client hides that row instead of
   * rendering something broken, never a fabricated placeholder.
   */
  async getPublic() {
    const row = await this.repository.get()
    return this._toView(row)
  }

  /** Same shape as the public view — nothing sensitive lives in this table, so there's no separate masked/admin view. */
  async getAdmin() {
    const row = await this.repository.get()
    return this._toView(row)
  }

  async save({ brandName, supportPhone, supportEmail } = {}, updatedBy = null) {
    const data = {}

    if (brandName !== undefined) {
      const trimmed = (brandName || '').trim()
      if (!trimmed) {
        const err = new Error('Brand name cannot be empty')
        err.statusCode = 400
        err.code = 'INVALID_BRAND_NAME'
        throw err
      }
      data.brand_name = trimmed
    }

    if (supportPhone !== undefined) {
      const trimmed = (supportPhone || '').trim()
      if (trimmed && !PHONE_RE.test(trimmed)) {
        const err = new Error('That does not look like a valid phone number')
        err.statusCode = 400
        err.code = 'INVALID_PHONE'
        throw err
      }
      data.support_phone = trimmed || null
    }

    if (supportEmail !== undefined) {
      const trimmed = (supportEmail || '').trim()
      if (trimmed && !EMAIL_RE.test(trimmed)) {
        const err = new Error('That does not look like a valid email address')
        err.statusCode = 400
        err.code = 'INVALID_EMAIL'
        throw err
      }
      data.support_email = trimmed || null
    }

    if (Object.keys(data).length === 0) {
      return this.getAdmin()
    }

    const row = await this.repository.save(data, updatedBy)
    return this._toView(row)
  }

  /** @private */
  _toView(row) {
    if (!row) {
      return { brandName: 'FreshCuts', supportPhone: null, supportEmail: null, updatedAt: null }
    }
    return {
      brandName: row.brand_name,
      supportPhone: row.support_phone || null,
      supportEmail: row.support_email || null,
      updatedAt: row.updated_at,
    }
  }
}
