import { logger } from '../../config/logger.js'
import { WhatsAppRepository } from './whatsapp.repository.js'
import { WhatsAppChatRepository } from './whatsapp.chat.repository.js'
import { getWhatsAppManager, phoneFromJid } from './whatsapp.manager.js'

const log = logger
export const MAX_MEDIA_BYTES = 16 * 1024 * 1024
const PURGE_EVERY_MS = 10 * 60 * 1000

const PREVIEW_LABEL = {
  image: '📷 Photo', video: '🎥 Video', audio: '🎤 Audio', document: '📄 Document', sticker: 'Sticker', other: 'Message',
}

// ─── pure helpers (exported for tests) ──────────────────────────────────────

/** Rolling retention: a conversation lives `days` after its LAST message. */
export function computeExpiry(lastMessageAt, days) {
  return new Date(new Date(lastMessageAt).getTime() + Number(days) * 86_400_000)
}

export function messagePreview(type, body) {
  const text = String(body || '').replace(/\s+/g, ' ').trim()
  if (type === 'text') return text.slice(0, 200) || 'Message'
  const label = PREVIEW_LABEL[type] || 'Message'
  return text ? `${label} ${text}`.slice(0, 200) : label
}

export function typeFromMime(mime = '') {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'document'
}

/** Baileys content object for an outgoing file. */
export function buildMediaContent({ buffer, mime, name, caption }) {
  const type = typeFromMime(mime)
  if (type === 'image') return { type, content: { image: buffer, mimetype: mime, caption: caption || undefined } }
  if (type === 'video') return { type, content: { video: buffer, mimetype: mime, caption: caption || undefined } }
  if (type === 'audio') return { type, content: { audio: buffer, mimetype: mime } }
  return { type, content: { document: buffer, mimetype: mime || 'application/octet-stream', fileName: name || 'file', caption: caption || undefined } }
}

export class WhatsAppChatService {
  constructor(
    repo = new WhatsAppChatRepository(),
    settingsRepo = new WhatsAppRepository(),
    manager = getWhatsAppManager()
  ) {
    this.repo = repo
    this.settingsRepo = settingsRepo
    this.manager = manager
    this.timer = null
  }

  start() {
    this.manager.on('incoming', (evt) => {
      this.handleIncoming(evt).catch((err) => log.error({ err: err.message }, 'WhatsApp incoming message failed'))
    })
    this.timer = setInterval(() => {
      this.purgeExpired().catch((err) => log.error({ err: err.message }, 'WhatsApp chat purge failed'))
    }, PURGE_EVERY_MS)
    this.timer.unref?.()
    this.purgeExpired().catch(() => {})
  }

  stop() {
    clearInterval(this.timer)
  }

  async _retentionDays() {
    const s = await this.settingsRepo.getSettings()
    return s?.chat_retention_days || 3
  }

  async _record(args) {
    const days = await this._retentionDays()
    const at = args.at ? new Date(args.at) : new Date()
    const result = await this.repo.recordMessage({
      ...args,
      at,
      expiresAt: computeExpiry(at, days),
      preview: messagePreview(args.type || 'text', args.body),
    })
    if (!result.duplicate) await this._notifyDashboard(result.conversation.id)
    return result
  }

  /** Customer (or the phone itself) produced a message. */
  async handleIncoming(evt) {
    return this._record({
      jid: evt.jid,
      phone: evt.phone,
      name: evt.fromMe ? null : evt.name,
      direction: evt.fromMe ? 'OUT' : 'IN',
      type: evt.type,
      body: evt.body,
      waMessageId: evt.waMessageId,
      source: evt.fromMe ? 'MANUAL' : 'CUSTOMER',
      media: evt.media,
      at: evt.timestamp,
    })
  }

  /** The automated order-message sender reports what it sent so the thread is complete. */
  async recordAutomated({ jid, phone, body, waMessageId }) {
    return this._record({ jid, phone, direction: 'OUT', type: 'text', body, waMessageId, source: 'AUTOMATED' })
  }

  async _notifyDashboard(conversationId) {
    try {
      const { getSocketIo } = await import('../../plugins/socketio.plugin.js')
      getSocketIo()?.to('admin:dashboard').emit('whatsapp:message', { conversationId })
    } catch { /* realtime is best-effort; the dashboard also polls */ }
  }

  // ── dashboard reads ───────────────────────────────────────────────────────
  async listConversations(opts) {
    const [conversations, unreadTotal, days] = await Promise.all([
      this.repo.listConversations(opts), this.repo.unreadTotal(), this._retentionDays(),
    ])
    return { conversations, unreadTotal, retentionDays: days }
  }

  async getThread(id, opts) {
    const conversation = await this.repo.getConversation(id)
    if (!conversation) throw this._notFound()
    const messages = await this.repo.listMessages(id, opts)
    return { conversation, messages }
  }

  async markRead(id) {
    await this.repo.markRead(id)
  }

  async getMedia(messageId) {
    return this.repo.getMedia(messageId)
  }

  async deleteConversation(id) {
    if (!(await this.repo.deleteConversation(id))) throw this._notFound()
  }

  // ── replies from the dashboard ────────────────────────────────────────────
  async sendText(conversationId, text) {
    const conversation = await this._requireConversation(conversationId)
    const body = String(text || '').trim()
    if (!body) throw this._bad('Type a message first')
    if (body.length > 4000) throw this._bad('Message is too long (max 4000 characters)')
    const { messageId } = await this._send(conversation.jid, { text: body })
    return this._record({
      jid: conversation.jid, phone: conversation.phone, direction: 'OUT', type: 'text', body,
      waMessageId: messageId, source: 'MANUAL',
    })
  }

  async sendFile(conversationId, { buffer, mime, name, caption }) {
    const conversation = await this._requireConversation(conversationId)
    if (!buffer?.length) throw this._bad('The file is empty')
    if (buffer.length > MAX_MEDIA_BYTES) throw this._bad('File is too large (max 16 MB)')
    const { type, content } = buildMediaContent({ buffer, mime, name, caption })
    const { messageId } = await this._send(conversation.jid, content)
    return this._record({
      jid: conversation.jid, phone: conversation.phone, direction: 'OUT', type, body: caption || (type === 'document' ? name : null),
      waMessageId: messageId, source: 'MANUAL', media: { buffer, mime, name },
    })
  }

  async _send(jid, content) {
    try {
      return await this.manager.sendRaw(jid, content)
    } catch (err) {
      if (err.code === 'NOT_CONNECTED') throw this._bad('WhatsApp is not connected — connect it from the WhatsApp page first')
      throw err
    }
  }

  async _requireConversation(id) {
    const c = await this.repo.getConversation(id)
    if (!c) throw this._notFound()
    return c
  }

  _notFound() {
    return Object.assign(new Error('Conversation not found'), { statusCode: 404, code: 'NOT_FOUND' })
  }

  _bad(message) {
    return Object.assign(new Error(message), { statusCode: 400, code: 'VALIDATION_ERROR' })
  }

  // ── retention ─────────────────────────────────────────────────────────────
  async purgeExpired() {
    const n = await this.repo.purgeExpired()
    if (n) log.info({ conversations: n }, 'WhatsApp chats past their retention window deleted')
    return n
  }

  async applyRetention(days) {
    await this.repo.rebuildExpiry(days)
    return this.purgeExpired()
  }
}

let instance = null
export function getWhatsAppChatService() {
  if (!instance) instance = new WhatsAppChatService()
  return instance
}

export { phoneFromJid }
