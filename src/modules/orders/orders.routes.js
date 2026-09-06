/**
 * Orders Routes — Fastify Plugin for Orders & Fulfilment Endpoints
 * Source of truth: Blueprint §06.7, Phase 8
 *
 * @module modules/orders/orders.routes
 */

import { OrdersRepository } from './orders.repository.js'
import { CartQuoteRepository } from '../cart-quote/cart-quote.repository.js'
import { OrdersService } from './orders.service.js'
import { OrdersController } from './orders.controller.js'
import { CreateOrderFromQuoteSchema, UpdateOrderStatusSchema, CreateFulfilmentTaskSchema, UpdateFulfilmentTaskSchema } from './orders.schema.js'

export async function ordersRoutes(fastify) {
  const repository = new OrdersRepository()
  const quoteRepository = new CartQuoteRepository()
  const service = new OrdersService(repository, quoteRepository)
  const controller = new OrdersController(service)

  // 1. Create Order from Checkout Quote
  fastify.post('/', {
    preHandler: [fastify.authenticate],
    schema: { body: CreateOrderFromQuoteSchema },
    handler: controller.createOrderFromQuote,
  })

  // 2. Transition Order Status (17-State Machine)
  fastify.patch('/:orderId/status', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('orders.update'),
    ],
    schema: { body: UpdateOrderStatusSchema },
    handler: controller.transitionOrderStatus,
  })

  // 3. Create Fulfilment Task (Picking / Packing)
  fastify.post('/:orderId/fulfilment-tasks', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('fulfilment.manage'),
    ],
    schema: { body: CreateFulfilmentTaskSchema },
    handler: controller.createFulfilmentTask,
  })

  // 4. Update Fulfilment Task Status
  fastify.patch('/fulfilment-tasks/:taskId', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('fulfilment.manage'),
    ],
    schema: { body: UpdateFulfilmentTaskSchema },
    handler: controller.updateFulfilmentTaskStatus,
  })

  // 5. Get Order by ID
  fastify.get('/:orderId', {
    preHandler: [fastify.authenticate],
    handler: controller.getOrderById,
  })

  // 6. List Orders
  fastify.get('/', {
    preHandler: [fastify.authenticate],
    handler: controller.listOrders,
  })
}

export default ordersRoutes
