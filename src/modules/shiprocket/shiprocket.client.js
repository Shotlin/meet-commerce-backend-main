const BASE_URL = 'https://apiv2.shiprocket.in/v1/external'
const TIMEOUT_MS = 10000

export class ShiprocketError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

/**
 * Thin Shiprocket HTTP client. Tokens are cached in-process per email
 * (Shiprocket tokens live ~10 days); a 401 triggers one re-login.
 */
export class ShiprocketClient {
  constructor(credentials, fetchImpl = globalThis.fetch) {
    this.credentials = credentials
    this.fetch = fetchImpl
    this.token = null
  }

  async #call(path, { method = 'GET', body, token } = {}) {
    const res = await this.fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const text = await res.text()
    let data = null
    try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
    if (!res.ok) {
      throw new ShiprocketError(data?.message || `Shiprocket responded ${res.status}`, res.status)
    }
    return data
  }

  async login() {
    const data = await this.#call('/auth/login', {
      method: 'POST',
      body: { email: this.credentials.email, password: this.credentials.password },
    })
    if (!data?.token) throw new ShiprocketError('Shiprocket login returned no token', 502)
    this.token = data.token
    return this.token
  }

  async request(path, opts = {}) {
    if (!this.token) await this.login()
    try {
      return await this.#call(path, { ...opts, token: this.token })
    } catch (err) {
      if (err.status !== 401) throw err
      await this.login()
      return this.#call(path, { ...opts, token: this.token })
    }
  }

  /** Pickup addresses configured in the Shiprocket panel (needs the Settings module). */
  async listPickupLocations() {
    const data = await this.request('/settings/company/pickup')
    return data?.data?.shipping_address || []
  }
}
