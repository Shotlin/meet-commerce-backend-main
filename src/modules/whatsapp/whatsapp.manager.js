import { EventEmitter } from 'node:events'
import QRCode from 'qrcode'
import { logger } from '../../config/logger.js'
import { getClient } from '../../config/database.js'
import { WhatsAppRepository } from './whatsapp.repository.js'
import { useDbAuthState } from './whatsapp.auth-state.js'

/**
 * Owns the single WhatsApp (Baileys) socket for the whole platform.
 *
 * Runs ONLY in the API process. A Postgres advisory lock guarantees that even
 * if a second API container ever starts, it will not open a second socket on
 * the same linked device (WhatsApp would kick one of them off, and flapping
 * sessions is exactly what gets numbers flagged).
 *
 * States: DISCONNECTED · CONNECTING · QR · CONNECTED · LOGGED_OUT · ERROR
 */
const LOCK_KEY = 7_726_001
const log = logger

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function phoneFromJid(jid) {
  if (!jid) return null
  const digits = String(jid).split('@')[0].split(':')[0].replace(/\D/g, '')
  return digits || null
}

export class WhatsAppManager extends EventEmitter {
  constructor(repo = new WhatsAppRepository()) {
    super()
    this.repo = repo
    this.sock = null
    this.state = 'DISCONNECTED'
    this.qrDataUrl = null
    this.lastError = null
    this.user = null
    this.manualStop = false
    this.reconnectAttempts = 0
    this.reconnectTimer = null
    this.lockClient = null
    this.baileys = null
    this.generation = 0
  }

  getStatus() {
    return {
      state: this.state,
      connected: this.state === 'CONNECTED',
      qr: this.state === 'QR' ? this.qrDataUrl : null,
      phone: this.user?.phone || null,
      name: this.user?.name || null,
      lastError: this.lastError,
      reconnectAttempts: this.reconnectAttempts,
    }
  }

  /** Called once at API boot. Reconnects automatically if a session was saved. */
  async start() {
    try {
      await this.repo.resetStuck()
      if (await this.repo.hasAuthCreds()) {
        await this.connect()
      }
    } catch (err) {
      log.error({ err: err.message }, 'WhatsApp start failed')
    }
  }

  async _acquireLock() {
    if (this.lockClient) return true
    const client = await getClient()
    try {
      const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY])
      if (rows[0].ok) {
        this.lockClient = client
        client.on('error', () => { this.lockClient = null })
        return true
      }
    } catch (err) {
      log.warn({ err: err.message }, 'advisory lock check failed')
    }
    client.release()
    return false
  }

  async _releaseLock() {
    if (!this.lockClient) return
    try { await this.lockClient.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]) } catch { /* ignore */ }
    this.lockClient.release()
    this.lockClient = null
  }

  async _loadBaileys() {
    if (!this.baileys) {
      try {
        this.baileys = await import('@whiskeysockets/baileys')
      } catch (err) {
        this.state = 'ERROR'
        this.lastError = 'WhatsApp library is not installed on the server'
        throw new Error(this.lastError, { cause: err })
      }
    }
    return this.baileys
  }

  /** Opens the socket (shows a QR if the device isn't linked yet). Idempotent. */
  async connect() {
    if (this.state === 'CONNECTING' || this.state === 'QR' || this.state === 'CONNECTED') return this.getStatus()
    clearTimeout(this.reconnectTimer)
    this.manualStop = false

    if (!(await this._acquireLock())) {
      this.state = 'ERROR'
      this.lastError = 'Another server instance already holds the WhatsApp session'
      return this.getStatus()
    }

    this.state = 'CONNECTING'
    this.lastError = null
    const generation = ++this.generation

    try {
      const baileys = await this._loadBaileys()
      const { default: makeWASocket, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, DisconnectReason, Browsers } = baileys
      const { state, saveCreds } = await useDbAuthState(this.repo, baileys)
      const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }))
      const quiet = logger.child({ module: 'baileys' })
      quiet.level = 'warn'

      const sock = makeWASocket({
        ...(version ? { version } : {}),
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, quiet) },
        logger: quiet,
        browser: Browsers.ubuntu('Chrome'),
        markOnlineOnConnect: false,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
      })
      this.sock = sock

      sock.ev.on('creds.update', saveCreds)

      sock.ev.on('connection.update', async (update) => {
        if (generation !== this.generation) return
        const { connection, lastDisconnect, qr } = update

        if (qr) {
          this.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 280 })
          this.state = 'QR'
          this.emit('status', this.getStatus())
        }

        if (connection === 'open') {
          this.reconnectAttempts = 0
          this.qrDataUrl = null
          this.lastError = null
          this.user = { phone: phoneFromJid(sock.user?.id), name: sock.user?.name || null }
          this.state = 'CONNECTED'
          await this.repo.markConnected(this.user).catch(() => {})
          log.info({ phone: this.user.phone }, 'WhatsApp connected')
          this.emit('status', this.getStatus())
        }

        if (connection === 'close') {
          const code = lastDisconnect?.error?.output?.statusCode
          this.sock = null
          this.qrDataUrl = null
          if (this.manualStop) return

          if (code === DisconnectReason.loggedOut) {
            await this.repo.authClear().catch(() => {})
            await this.repo.clearConnection().catch(() => {})
            this.user = null
            this.state = 'LOGGED_OUT'
            this.lastError = 'WhatsApp was unlinked from the phone'
            await this._releaseLock()
          } else if (code === DisconnectReason.connectionReplaced) {
            this.state = 'ERROR'
            this.lastError = 'This WhatsApp account was opened somewhere else'
            await this._releaseLock()
          } else {
            // 515 "restart required" is normal right after scanning; everything else backs off.
            this.state = 'DISCONNECTED'
            this.lastError = `Connection closed (${code ?? 'unknown'})`
            this._scheduleReconnect(code === DisconnectReason.restartRequired ? 500 : undefined)
          }
          this.emit('status', this.getStatus())
        }
      })

      sock.ev.on('messages.upsert', ({ messages, type }) => {
        if (type !== 'notify') return
        for (const m of messages || []) this._handleIncoming(m)
      })
    } catch (err) {
      this.state = 'ERROR'
      this.lastError = err.message
      log.error({ err: err.message }, 'WhatsApp connect failed')
      await this._releaseLock()
    }
    return this.getStatus()
  }

  _scheduleReconnect(forceDelay) {
    this.reconnectAttempts += 1
    const delay = forceDelay ?? Math.min(2000 * 2 ** Math.min(this.reconnectAttempts, 5), 60_000)
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => {
      this.state = 'DISCONNECTED'
      this.connect().catch(() => {})
    }, delay)
    this.reconnectTimer.unref?.()
  }

  /** STOP / UNSUBSCRIBE replies are honoured automatically. */
  _handleIncoming(message) {
    try {
      if (message.key?.fromMe) return
      const text = (message.message?.conversation || message.message?.extendedTextMessage?.text || '').trim()
      if (!/^(stop|unsubscribe|cancel messages?)$/i.test(text)) return
      const jid = [message.key.remoteJidAlt, message.key.senderPn, message.key.remoteJid]
        .find((j) => j && String(j).endsWith('@s.whatsapp.net'))
      const phone = phoneFromJid(jid)
      if (phone) {
        this.repo.addOptOut(phone).catch(() => {})
        log.info({ phone }, 'Customer opted out of WhatsApp messages')
      }
    } catch { /* never let an incoming message break the socket */ }
  }

  /**
   * Sends one text. Throws an Error with `.code = 'NOT_ON_WHATSAPP'` for numbers
   * without WhatsApp (sending to those hurts the number's reputation, so the
   * caller skips instead of retrying).
   */
  async sendText(phone, body, { typing = true } = {}) {
    if (this.state !== 'CONNECTED' || !this.sock) throw Object.assign(new Error('WhatsApp not connected'), { code: 'NOT_CONNECTED' })
    const lookup = await this.sock.onWhatsApp(`${phone}@s.whatsapp.net`)
    const hit = lookup?.[0]
    if (!hit?.exists) throw Object.assign(new Error('Number is not on WhatsApp'), { code: 'NOT_ON_WHATSAPP' })
    const jid = hit.jid

    if (typing) {
      try {
        await this.sock.sendPresenceUpdate('composing', jid)
        // ~ a person typing: base + per-character time, with jitter, capped.
        const ms = Math.min(6500, 1200 + body.length * 28 + Math.random() * 1500)
        await sleep(ms)
        await this.sock.sendPresenceUpdate('paused', jid)
      } catch { /* presence is cosmetic */ }
    }
    const result = await this.sock.sendMessage(jid, { text: body })
    return { messageId: result?.key?.id || null }
  }

  /** Close the socket but keep the saved session (can reconnect without a QR). */
  async disconnect() {
    this.manualStop = true
    clearTimeout(this.reconnectTimer)
    this.generation += 1
    try { this.sock?.end?.(undefined) } catch { /* ignore */ }
    this.sock = null
    this.qrDataUrl = null
    this.state = 'DISCONNECTED'
    await this._releaseLock()
    this.emit('status', this.getStatus())
    return this.getStatus()
  }

  /** Unlink this device from the phone and forget the session. */
  async logout() {
    this.manualStop = true
    clearTimeout(this.reconnectTimer)
    this.generation += 1
    try { await this.sock?.logout?.() } catch { /* already gone */ }
    try { this.sock?.end?.(undefined) } catch { /* ignore */ }
    this.sock = null
    await this.repo.authClear()
    await this.repo.clearConnection()
    this.user = null
    this.qrDataUrl = null
    this.state = 'DISCONNECTED'
    await this._releaseLock()
    this.emit('status', this.getStatus())
    return this.getStatus()
  }

  async stop() {
    this.manualStop = true
    clearTimeout(this.reconnectTimer)
    try { this.sock?.end?.(undefined) } catch { /* ignore */ }
    await this._releaseLock()
  }
}

let instance = null
export function getWhatsAppManager() {
  if (!instance) instance = new WhatsAppManager()
  return instance
}
