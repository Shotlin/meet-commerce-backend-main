import { getWhatsAppService } from './whatsapp.service.js'
import { getWhatsAppManager } from './whatsapp.manager.js'
import { EVENT_KEYS } from './whatsapp.templates.js'
import { success } from '../../utils/apiResponse.js'

/**
 * WhatsApp (unofficial) admin routes. Prefix: /api/v1/admin/whatsapp
 *
 *   GET    /overview              connection + settings + counters (poll while linking)
 *   POST   /connect               open the socket → QR appears in /overview
 *   POST   /disconnect            close, keep the session
 *   POST   /logout                unlink the phone + forget the session
 *   PUT    /settings              pacing, limits, quiet hours, master switch
 *   GET    /events                every event with its on/off + variants
 *   PUT    /events/:key           save on/off + variants
 *   DELETE /events/:key           back to the built-in defaults
 *   POST   /events/:key/preview   render N sample messages for the given variants
 *   POST   /test                  queue a sample message to any number
 *   GET    /messages              send log
 *   DELETE /opt-outs/:phone       let a customer who said STOP be messaged again
 */
export default async function whatsappRoutes(fastify) {
  const service = getWhatsAppService()
  const manager = getWhatsAppManager()
  const adminAuth = [fastify.authenticate, fastify.requireAdmin]
  const tags = ['Admin - WhatsApp']
  const eventParams = { type: 'object', properties: { key: { type: 'string', enum: EVENT_KEYS } }, required: ['key'] }
  const int = (min, max) => ({ type: 'integer', minimum: min, maximum: max })

  fastify.get('/overview', { schema: { tags }, preHandler: adminAuth }, async (req, reply) =>
    reply.send(success(await service.getOverview(), 'WhatsApp overview')))

  fastify.post('/connect', { schema: { tags }, preHandler: adminAuth }, async (req, reply) =>
    reply.send(success(await manager.connect(), 'Connecting to WhatsApp')))

  fastify.post('/disconnect', { schema: { tags }, preHandler: adminAuth }, async (req, reply) =>
    reply.send(success(await manager.disconnect(), 'WhatsApp disconnected')))

  fastify.post('/logout', { schema: { tags }, preHandler: adminAuth }, async (req, reply) =>
    reply.send(success(await manager.logout(), 'WhatsApp unlinked')))

  fastify.put('/settings', {
    schema: {
      tags,
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          enabled: { type: 'boolean' },
          countryCode: { type: 'string', pattern: '^[0-9]{1,4}$' },
          sendDelayMinSec: int(0, 3600),
          sendDelayMaxSec: int(0, 3600),
          minGapSec: int(3, 600),
          maxGapSec: int(3, 900),
          typingSimulation: { type: 'boolean' },
          hourlyCap: int(1, 500),
          dailyCap: int(1, 5000),
          warmupEnabled: { type: 'boolean' },
          quietHoursEnabled: { type: 'boolean' },
          quietStartMin: int(0, 1439),
          quietEndMin: int(0, 1439),
        },
      },
    },
    preHandler: adminAuth,
  }, async (req, reply) =>
    reply.send(success(await service.saveSettings(req.body, req.user?.id), 'WhatsApp settings saved')))

  fastify.get('/events', { schema: { tags }, preHandler: adminAuth }, async (req, reply) =>
    reply.send(success(await service.listEvents(), 'WhatsApp events')))

  fastify.put('/events/:key', {
    schema: {
      tags,
      params: eventParams,
      body: {
        type: 'object',
        required: ['enabled', 'variants'],
        properties: {
          enabled: { type: 'boolean' },
          variants: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 1000 } },
        },
      },
    },
    preHandler: adminAuth,
  }, async (req, reply) =>
    reply.send(success(await service.saveEvent(req.params.key, req.body), 'Event saved')))

  fastify.delete('/events/:key', { schema: { tags, params: eventParams }, preHandler: adminAuth }, async (req, reply) =>
    reply.send(success(await service.resetEvent(req.params.key), 'Event reset to defaults')))

  fastify.post('/events/:key/preview', {
    schema: {
      tags,
      params: eventParams,
      body: {
        type: 'object',
        properties: {
          variants: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 1000 } },
          count: int(1, 10),
        },
      },
    },
    preHandler: adminAuth,
  }, async (req, reply) =>
    reply.send(success({ messages: service.preview(req.params.key, req.body?.variants, req.body?.count || 5) }, 'Preview')))

  fastify.post('/test', {
    schema: {
      tags,
      body: {
        type: 'object',
        required: ['phone'],
        properties: {
          phone: { type: 'string', maxLength: 20 },
          eventKey: { type: 'string', enum: EVENT_KEYS },
          variants: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 1000 } },
        },
      },
    },
    preHandler: adminAuth,
  }, async (req, reply) =>
    reply.send(success(await service.sendTest(req.body), 'Test message queued')))

  fastify.get('/messages', {
    schema: {
      tags,
      querystring: {
        type: 'object',
        properties: {
          limit: int(1, 200),
          offset: { type: 'integer', minimum: 0 },
          status: { type: 'string', enum: ['QUEUED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED'] },
        },
      },
    },
    preHandler: adminAuth,
  }, async (req, reply) =>
    reply.send(success(await service.listMessages(req.query), 'WhatsApp messages')))

  fastify.delete('/opt-outs/:phone', {
    schema: { tags, params: { type: 'object', properties: { phone: { type: 'string', maxLength: 20 } }, required: ['phone'] } },
    preHandler: adminAuth,
  }, async (req, reply) => {
    await service.removeOptOut(req.params.phone)
    return reply.send(success(null, 'Customer can receive WhatsApp messages again'))
  })
}
