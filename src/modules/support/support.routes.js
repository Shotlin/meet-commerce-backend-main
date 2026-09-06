/**
 * Support Routes — Fastify Plugin for Support Tickets, Product Recalls & Traceability Endpoints
 * Source of truth: Blueprint §06.9, Phase 10
 *
 * @module modules/support/support.routes
 */

import { SupportRepository } from './support.repository.js'
import { SupportService } from './support.service.js'
import { SupportController } from './support.controller.js'
import { CreateTicketSchema, AssignTicketSchema, UpdateTicketStatusSchema, AddTicketCommentSchema, CreateRecallSchema } from './support.schema.js'

export async function supportRoutes(fastify) {
  const repository = new SupportRepository()
  const service = new SupportService(repository)
  const controller = new SupportController(service)

  // 1. Support Tickets
  fastify.post('/tickets', {
    preHandler: [fastify.authenticate],
    schema: { body: CreateTicketSchema },
    handler: controller.createTicket,
  })

  fastify.patch('/tickets/:ticketId/assign', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('support.manage'),
    ],
    schema: { body: AssignTicketSchema },
    handler: controller.assignTicket,
  })

  fastify.patch('/tickets/:ticketId/status', {
    preHandler: [fastify.authenticate],
    schema: { body: UpdateTicketStatusSchema },
    handler: controller.updateTicketStatus,
  })

  fastify.post('/tickets/:ticketId/comments', {
    preHandler: [fastify.authenticate],
    schema: { body: AddTicketCommentSchema },
    handler: controller.addTicketComment,
  })

  fastify.get('/tickets/:ticketId', {
    preHandler: [fastify.authenticate],
    handler: controller.getTicketById,
  })

  fastify.get('/tickets', {
    preHandler: [fastify.authenticate],
    handler: controller.listTickets,
  })

  // 2. Product Recalls
  fastify.get('/recalls', {
    preHandler: [fastify.authenticate],
    handler: controller.listRecalls,
  })

  fastify.post('/recalls', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('recalls.manage'),
    ],
    schema: { body: CreateRecallSchema },
    handler: controller.createRecall,
  })

  fastify.patch('/recalls/:recallId/status', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('recalls.manage'),
    ],
    handler: controller.updateRecallStatus,
  })

  fastify.post('/recalls/:recallId/quarantine', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('recalls.manage'),
    ],
    handler: controller.quarantineRecall,
  })

  fastify.post('/recalls/:recallId/notify', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('recalls.manage'),
    ],
    handler: controller.notifyTaskforce,
  })

  // 3. Batch Traceability
  fastify.get('/traceability/:productId', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('traceability.view'),
    ],
    handler: controller.getTraceabilityHistory,
  })
}

export default supportRoutes
