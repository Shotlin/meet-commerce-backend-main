/**
 * Procurement Routes — Fastify Plugin for Procurement & Goods Receipt Endpoints
 * Source of truth: Blueprint §06.3, Phase 4A
 *
 * @module modules/procurement/procurement.routes
 */

import { ProcurementRepository } from './procurement.repository.js'
import { ProcurementService } from './procurement.service.js'
import { ProcurementController } from './procurement.controller.js'
import { CreateProcurementSchema, GoodsReceiptSchema, AddProcurementMediaSchema } from './procurement.schema.js'
import { requireVendorScope } from '../../middlewares/vendor-scope.js'

export async function procurementRoutes(fastify) {
  const repository = new ProcurementRepository()
  const service = new ProcurementService(repository)
  const controller = new ProcurementController(service)

  // 1. Create Procurement Order
  fastify.post('/', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('procurement.create'),
      requireVendorScope(),
    ],
    schema: { body: CreateProcurementSchema },
    handler: controller.createProcurement,
  })

  // 2. Submit Order
  fastify.post('/:orderId/submit', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('procurement.create'),
      requireVendorScope(),
    ],
    handler: controller.submitProcurement,
  })

  // 3. Approve Order (Admin / Manager)
  fastify.post('/:orderId/approve', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('procurement.approve'),
    ],
    handler: controller.approveProcurement,
  })

  // 4. Cancel Order
  fastify.post('/:orderId/cancel', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('procurement.update'),
      requireVendorScope(),
    ],
    handler: controller.cancelProcurement,
  })

  // 5. Goods Receipt & Batching
  fastify.post('/:orderId/receipt', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('procurement.update'),
      requireVendorScope(),
    ],
    schema: { body: GoodsReceiptSchema },
    handler: controller.recordGoodsReceipt,
  })

  // 6. Media Evidence
  fastify.post('/:orderId/media', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('procurement.update'),
      requireVendorScope(),
    ],
    schema: { body: AddProcurementMediaSchema },
    handler: controller.addMedia,
  })

  // 7. Get Order by ID
  fastify.get('/:orderId', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('procurement.view'),
    ],
    handler: controller.getOrderById,
  })

  // 8. List Orders
  fastify.get('/', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('procurement.view'),
    ],
    handler: controller.listOrders,
  })
}

export default procurementRoutes
