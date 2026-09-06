import { sendPush } from '../../utils/pushNotification.js'
import { logger } from '../../config/logger.js'

/**
 * Notifications service — business logic for notifications
 */
export class NotificationsService {
  constructor(repository, fastify) {
    this.repository = repository
    this.fastify = fastify
  }

  async getNotifications(userId, { page, limit, unreadOnly }) {
    const offset = (page - 1) * limit
    return await this.repository.getNotifications(userId, { offset, limit, unreadOnly })
  }

  async markAsRead(userId, notificationId) {
    const notification = await this.repository.getNotificationById(notificationId)
    if (!notification) {
      throw new Error('Notification not found')
    }

    if (notification.user_id !== userId) {
      throw new Error('Not authorized to modify this notification')
    }

    return await this.repository.markAsRead(notificationId)
  }

  async markAllAsRead(userId) {
    return await this.repository.markAllAsRead(userId)
  }

  // Called by the app the moment a user taps/opens a push notification —
  // not tied to a specific in-app notification row id (the push payload
  // only carries the campaign id, since the same FCM payload goes to every
  // recipient). Idempotent: a repeat tap on an already-opened campaign is a
  // no-op at the repository level, so a campaign's opened_count only ever
  // counts each user once, however many times they tap.
  async markCampaignOpened(userId, campaignId) {
    return await this.repository.markCampaignOpened(userId, campaignId)
  }

  async deleteNotification(userId, notificationId) {
    const notification = await this.repository.getNotificationById(notificationId)
    if (!notification) {
      throw new Error('Notification not found')
    }

    if (notification.user_id !== userId) {
      throw new Error('Not authorized to delete this notification')
    }

    return await this.repository.deleteNotification(notificationId)
  }

  async getPreferences(userId) {
    return await this.repository.getPreferences(userId)
  }

  async updatePreferences(userId, preferences) {
    return await this.repository.updatePreferences(userId, preferences)
  }

  async registerToken(userId, token, platform) {
    return await this.repository.registerToken(userId, token, platform)
  }

  /**
   * Send notification — creates in-app + sends push + emits Socket.IO
   * Called by other modules (orders, delivery, etc.)
   */
  async sendNotification(userId, { title, body, type = 'general', data = {} }) {
    // 1. Create in-app notification
    const notification = await this.repository.createNotification(userId, {
      title, body, type, data,
    })

    // 2. Emit via Socket.IO for real-time
    try {
      if (this.fastify?.emitNotification) {
        this.fastify.emitNotification(userId, notification)
      }
    } catch (err) {
      logger.error({ err, userId }, 'Socket.IO notification emit failed')
    }

    // 3. Send push notification via FCM
    try {
      const tokens = await this.repository.getFcmTokens(userId)
      if (tokens.length > 0) {
        const tokenStrings = tokens.map(t => t.token)
        for (const token of tokenStrings) {
          await sendPush(token, { title, body, data: { ...data, notificationId: notification.id } })
        }
      }
    } catch (err) {
      logger.error({ err, userId }, 'FCM push notification failed')
    }

    return notification
  }

  // Alias for backward compatibility
  async createNotification(userId, opts) {
    return this.sendNotification(userId, opts)
  }
}
