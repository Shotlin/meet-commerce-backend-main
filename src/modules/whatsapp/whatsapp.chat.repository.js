import { query, getClient } from '../../config/database.js'

const CONV_COLUMNS = `id, jid, phone, display_name, last_message_at, last_message_preview, last_direction,
  unread_count, expires_at, created_at`
const MSG_COLUMNS = `id, conversation_id, wa_message_id, direction, type, body, media_name, media_mime,
  media_size, has_media, source, created_at`

export class WhatsAppChatRepository {
  /**
   * Stores one message (and its file) and moves the conversation's retention
   * clock forward — all in one transaction so a conversation can never exist
   * with a half-written message. Returns { conversation, message } or
   * { duplicate: true } when this WhatsApp message id was already stored.
   */
  async recordMessage({ jid, phone = null, name = null, direction, type = 'text', body = null,
    waMessageId = null, source = 'MANUAL', media = null, at = new Date(), expiresAt, preview }) {
    const client = await getClient()
    try {
      await client.query('BEGIN')
      const conv = await client.query(
        `INSERT INTO whatsapp_conversations
           (jid, phone, display_name, last_message_at, last_message_preview, last_direction, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (jid) DO UPDATE SET
           phone = COALESCE(EXCLUDED.phone, whatsapp_conversations.phone),
           display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), whatsapp_conversations.display_name),
           last_message_at = GREATEST(whatsapp_conversations.last_message_at, EXCLUDED.last_message_at),
           last_message_preview = CASE WHEN EXCLUDED.last_message_at >= whatsapp_conversations.last_message_at
                                       THEN EXCLUDED.last_message_preview ELSE whatsapp_conversations.last_message_preview END,
           last_direction = CASE WHEN EXCLUDED.last_message_at >= whatsapp_conversations.last_message_at
                                 THEN EXCLUDED.last_direction ELSE whatsapp_conversations.last_direction END,
           expires_at = GREATEST(whatsapp_conversations.expires_at, EXCLUDED.expires_at)
         RETURNING ${CONV_COLUMNS}`,
        [jid, phone, name, at, preview, direction, expiresAt]
      )
      const conversation = conv.rows[0]

      const msg = await client.query(
        `INSERT INTO whatsapp_chat_messages
           (conversation_id, wa_message_id, direction, type, body, media_name, media_mime, media_size, has_media, source, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT DO NOTHING
         RETURNING ${MSG_COLUMNS}`,
        [conversation.id, waMessageId, direction, type, body, media?.name ?? null, media?.mime ?? null,
          media?.buffer?.length ?? null, !!media?.buffer, source, at]
      )
      if (!msg.rows[0]) {
        await client.query('ROLLBACK')
        return { duplicate: true }
      }
      const message = msg.rows[0]
      if (media?.buffer) {
        await client.query('INSERT INTO whatsapp_chat_media (message_id, data) VALUES ($1, $2)', [message.id, media.buffer])
      }
      if (direction === 'IN') {
        const upd = await client.query(
          'UPDATE whatsapp_conversations SET unread_count = unread_count + 1 WHERE id = $1 RETURNING unread_count',
          [conversation.id]
        )
        conversation.unread_count = upd.rows[0].unread_count
      }
      await client.query('COMMIT')
      return { conversation, message }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  }

  async listConversations({ search, unreadOnly = false, limit = 100 } = {}) {
    const params = []
    const where = []
    if (search) {
      params.push(`%${search.replace(/[%_]/g, '\\$&')}%`)
      where.push(`(display_name ILIKE $${params.length} OR phone ILIKE $${params.length})`)
    }
    if (unreadOnly) where.push('unread_count > 0')
    params.push(limit)
    const { rows } = await query(
      `SELECT ${CONV_COLUMNS} FROM whatsapp_conversations
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY last_message_at DESC LIMIT $${params.length}`,
      params
    )
    return rows
  }

  async unreadTotal() {
    const { rows } = await query('SELECT COALESCE(SUM(unread_count),0)::int AS n FROM whatsapp_conversations')
    return rows[0].n
  }

  async getConversation(id) {
    const { rows } = await query(`SELECT ${CONV_COLUMNS} FROM whatsapp_conversations WHERE id = $1`, [id])
    return rows[0] || null
  }

  /** Newest `limit` messages (or the `limit` before `before`), returned oldest → newest. */
  async listMessages(conversationId, { before, limit = 100 } = {}) {
    const params = [conversationId, limit]
    let cond = ''
    if (before) {
      params.push(before)
      cond = 'AND created_at < $3'
    }
    const { rows } = await query(
      `SELECT ${MSG_COLUMNS} FROM whatsapp_chat_messages
        WHERE conversation_id = $1 ${cond} ORDER BY created_at DESC LIMIT $2`,
      params
    )
    return rows.reverse()
  }

  async markRead(id) {
    await query('UPDATE whatsapp_conversations SET unread_count = 0 WHERE id = $1', [id])
  }

  async getMedia(messageId) {
    const { rows } = await query(
      `SELECT m.media_mime, m.media_name, c.data FROM whatsapp_chat_messages m
         JOIN whatsapp_chat_media c ON c.message_id = m.id WHERE m.id = $1`,
      [messageId]
    )
    return rows[0] || null
  }

  async deleteConversation(id) {
    const { rowCount } = await query('DELETE FROM whatsapp_conversations WHERE id = $1', [id])
    return rowCount > 0
  }

  /**
   * Deletes ONLY conversations whose retention clock has run out
   * (no message in or out for the whole retention window). Messages and files
   * go with them through ON DELETE CASCADE — one statement, no orphans.
   */
  async purgeExpired(now = new Date()) {
    const { rowCount } = await query('DELETE FROM whatsapp_conversations WHERE expires_at <= $1', [now])
    return rowCount
  }

  /** When the admin changes the window, every conversation is re-timed from its own last message. */
  async rebuildExpiry(days) {
    await query(
      `UPDATE whatsapp_conversations SET expires_at = last_message_at + ($1 || ' days')::interval`,
      [String(days)]
    )
  }
}
