// Regression coverage for the optional channelId/sound override added to
// NotificationsService#sendNotification — added so the vendor app's
// "new requirement" push can ring its own Android notification channel
// (with a custom alert sound) instead of every notification type sharing
// the platform's one generic 'bakaloo_notifications' channel/'default'
// sound. Every existing call site that never passes these must keep
// getting sendPush's own unchanged defaults.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const pushMock = vi.hoisted(() => ({ sendPush: vi.fn().mockResolvedValue({ success: true, messageId: 'm1' }) }))
vi.mock('../../../src/utils/pushNotification.js', () => pushMock)

import { NotificationsService } from '../../../src/modules/notifications/notifications.service.js'

function buildRepository({ tokens = [{ token: 'tok-1' }] } = {}) {
  return {
    createNotification: vi.fn().mockResolvedValue({ id: 'notif-1' }),
    getFcmTokens: vi.fn().mockResolvedValue(tokens),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('NotificationsService#sendNotification — channelId/sound passthrough', () => {
  it('forwards an explicit channelId/sound to sendPush', async () => {
    const repository = buildRepository()
    const service = new NotificationsService(repository, { emitNotification: vi.fn() })

    await service.sendNotification('user-1', {
      title: 'New procurement requirement',
      body: 'Respond before the deadline.',
      type: 'procurement',
      channelId: 'procurement_alerts',
      sound: 'new_requirement_alert',
    })

    expect(pushMock.sendPush).toHaveBeenCalledWith(
      'tok-1',
      expect.objectContaining({ channelId: 'procurement_alerts', sound: 'new_requirement_alert' })
    )
  })

  it('omits channelId/sound entirely when the caller does not pass them, so sendPush keeps its own default channel/sound', async () => {
    const repository = buildRepository()
    const service = new NotificationsService(repository, { emitNotification: vi.fn() })

    await service.sendNotification('user-1', { title: 'Order update', body: 'Your order shipped.' })

    const [, options] = pushMock.sendPush.mock.calls[0]
    expect(options).not.toHaveProperty('channelId')
    expect(options).not.toHaveProperty('sound')
  })

  it('never calls sendPush at all when the user has no active FCM token', async () => {
    const repository = buildRepository({ tokens: [] })
    const service = new NotificationsService(repository, { emitNotification: vi.fn() })

    await service.sendNotification('user-1', { title: 'Hi', body: 'msg' })

    expect(pushMock.sendPush).not.toHaveBeenCalled()
  })
})
