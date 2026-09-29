import { ShiprocketRepository } from './shiprocket.repository.js'
import { ShiprocketClient } from './shiprocket.client.js'
import { emit } from '../../utils/audit-log.js'

function maskEmail(email) {
  if (!email) return null
  const [user, domain] = email.split('@')
  return `${user.slice(0, 2)}••••@${domain}`
}

function toView(row) {
  return {
    configured: Boolean(row?.api_email && row?.api_password_encrypted),
    email: maskEmail(row?.api_email),
    hasPassword: Boolean(row?.api_password_encrypted),
    pickupLocation: row?.pickup_location || null,
    lastTestedAt: row?.last_tested_at || null,
    lastTestStatus: row?.last_test_status || null,
    lastTestMessage: row?.last_test_message || null,
  }
}

/** Dashboard-managed Shiprocket API credentials; the password is never returned. */
export class ShiprocketService {
  constructor(repository = new ShiprocketRepository(), clientFactory = (c) => new ShiprocketClient(c)) {
    this.repository = repository
    this.clientFactory = clientFactory
  }

  async get() {
    return toView(await this.repository.get())
  }

  async save(input, adminId) {
    const row = await this.repository.save(input, adminId)
    emit('shiprocket_settings_updated', {
      actor_user_id: adminId,
      target_type: 'shiprocket_settings',
      after: {
        emailChanged: input?.email !== undefined,
        passwordChanged: input?.password !== undefined,
        pickupLocation: input?.pickupLocation,
      },
    })
    return toView(row)
  }

  /**
   * Logs in with a draft (email+password) or the stored credentials, and lists
   * the pickup locations. Always records the outcome on the stored row only
   * when testing stored credentials.
   */
  async test({ email, password } = {}, adminId) {
    const draft = Boolean(email && password)
    const credentials = draft ? { email, password } : await this.repository.getCredentialsDecrypted()
    if (!credentials) {
      const err = new Error('No Shiprocket credentials saved yet')
      err.statusCode = 400
      throw err
    }
    let result
    try {
      const client = this.clientFactory(credentials)
      await client.login()
      const pickups = await client.listPickupLocations().catch(() => null)
      result = {
        success: true,
        message: 'Connected to Shiprocket',
        pickupLocations: pickups
          ? pickups.map((p) => ({ name: p.pickup_location, city: p.city, pin: p.pin_code }))
          : null,
      }
    } catch (err) {
      result = { success: false, message: err.message || 'Connection failed', pickupLocations: null }
    }
    if (!draft) {
      await this.repository.recordTest(
        { status: result.success ? 'SUCCESS' : 'FAILED', message: result.message },
        adminId
      )
    }
    return result
  }
}
