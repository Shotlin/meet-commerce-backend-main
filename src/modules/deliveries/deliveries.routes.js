/**
 * Deliveries Routes — Fastify Plugin for Rider Shifts & Delivery Adaptation Endpoints
 * Source of truth: Blueprint §06.8, Phase 9
 *
 * @module modules/deliveries/deliveries.routes
 */

import { DeliveriesRepository } from './deliveries.repository.js'
import { OrdersRepository } from '../orders/orders.repository.js'
import { DeliveriesService } from './deliveries.service.js'
import { DeliveriesController } from './deliveries.controller.js'
import { CreateRiderSchema, UpdateShiftSchema, AssignDeliverySchema, UpdateDeliveryStatusSchema } from './deliveries.schema.js'

export async function deliveriesRoutes(fastify) {
  const repository = new DeliveriesRepository()
  const ordersRepository = new OrdersRepository()
  const service = new DeliveriesService(repository, ordersRepository)
  const controller = new DeliveriesController(service)

  // 1. Rider Profiles & Shifts
  fastify.post('/riders', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('riders.manage'),
    ],
    schema: { body: CreateRiderSchema },
    handler: controller.createRider,
  })

  fastify.post('/riders/:riderId/shifts/start', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('riders.manage'),
    ],
    handler: controller.startShift,
  })

  fastify.patch('/riders/:riderId/shifts/status', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('riders.manage'),
    ],
    schema: { body: UpdateShiftSchema },
    handler: controller.updateShiftStatus,
  })

  // 2. Delivery Assignments & Status Transitions
  fastify.post('/assignments', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('deliveries.manage'),
    ],
    schema: { body: AssignDeliverySchema },
    handler: controller.assignDelivery,
  })

  fastify.patch('/assignments/:assignmentId/status', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('deliveries.manage'),
    ],
    schema: { body: UpdateDeliveryStatusSchema },
    handler: controller.transitionDeliveryStatus,
  })

  // 3. Lists
  fastify.get('/riders', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('riders.view'),
    ],
    handler: controller.listRiders,
  })

  fastify.get('/assignments', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('deliveries.view'),
    ],
    handler: controller.listAssignments,
  })
}

export default deliveriesRoutes
