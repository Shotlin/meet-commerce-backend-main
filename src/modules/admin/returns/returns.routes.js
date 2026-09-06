import { ReturnsController } from './returns.controller.js'
import {
  listReturnsSchema,
  returnIdSchema,
  createReturnSchema,
  resolveReturnSchema,
} from './returns.schema.js'

const controller = new ReturnsController()

/**
 * Returns / RMA routes plugin
 * Mounted at /api/v1/admin/returns (see admin.routes.js)
 */
export default async function adminReturnsRoutes(fastify) {
  fastify.addHook('preHandler', async (request, reply) => {
    await fastify.authenticate(request, reply)
    await fastify.requireAdmin(request, reply)
  })

  fastify.get('/', { schema: listReturnsSchema }, controller.list.bind(controller))
  fastify.post('/', { schema: createReturnSchema }, controller.create.bind(controller))
  fastify.get('/:id', { schema: returnIdSchema }, controller.getDetail.bind(controller))
  fastify.post('/:id/approve', { schema: resolveReturnSchema }, controller.approve.bind(controller))
  fastify.post('/:id/reject', { schema: resolveReturnSchema }, controller.reject.bind(controller))
  fastify.post('/:id/cancel', { schema: resolveReturnSchema }, controller.cancel.bind(controller))
}
