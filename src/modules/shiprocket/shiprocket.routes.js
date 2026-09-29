import { ShiprocketService } from './shiprocket.service.js'
import { success } from '../../utils/apiResponse.js'

/**
 * Shiprocket settings admin routes. Prefix: /api/v1/admin/shiprocket
 *   GET  /settings — masked view      PUT /settings — save credentials/pickup
 *   POST /test     — draft or stored credentials, lists pickup locations
 */
export default async function shiprocketRoutes(fastify) {
  const service = new ShiprocketService()
  const adminAuth = [fastify.authenticate, fastify.requireAdmin]
  const tags = ['Admin - Shiprocket']

  fastify.get('/settings', { schema: { tags }, preHandler: adminAuth }, async (req, reply) =>
    reply.send(success(await service.get(), 'Shiprocket settings fetched')))

  fastify.put('/settings', {
    schema: {
      tags,
      body: {
        type: 'object',
        properties: {
          email: { type: 'string', maxLength: 200 },
          password: { type: 'string', maxLength: 200 },
          pickupLocation: { type: 'string', maxLength: 200 },
        },
      },
    },
    preHandler: adminAuth,
  }, async (req, reply) =>
    reply.send(success(await service.save(req.body, req.user?.id), 'Shiprocket settings saved')))

  fastify.post('/test', {
    schema: {
      tags,
      body: {
        type: 'object',
        properties: { email: { type: 'string', maxLength: 200 }, password: { type: 'string', maxLength: 200 } },
      },
    },
    preHandler: adminAuth,
  }, async (req, reply) => {
    const result = await service.test(req.body || {}, req.user?.id)
    return reply.send(success(result, result.success ? 'Connection successful' : 'Connection failed'))
  })
}
