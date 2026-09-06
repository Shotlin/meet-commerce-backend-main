/**
 * Warehouse Receipts Routes — Fastify Plugin for Receipts & Quality Control Endpoints
 * Source of truth: Blueprint §06.4, Phase 5A
 *
 * @module modules/warehouse-receipts/warehouse-receipts.routes
 */

import { WarehouseReceiptsRepository } from './warehouse-receipts.repository.js'
import { WarehouseReceiptsService } from './warehouse-receipts.service.js'
import { WarehouseReceiptsController } from './warehouse-receipts.controller.js'
import { CreateReceiptSchema, PerformQcSchema } from './warehouse-receipts.schema.js'
import { requireWarehouseScope } from '../../middlewares/warehouse-scope.js'

export async function warehouseReceiptsRoutes(fastify) {
  const repository = new WarehouseReceiptsRepository()
  const service = new WarehouseReceiptsService(repository)
  const controller = new WarehouseReceiptsController(service)

  // 1. Create Receipt
  fastify.post('/', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('warehouse_receipts.create'),
      requireWarehouseScope(),
    ],
    schema: { body: CreateReceiptSchema },
    handler: controller.createReceipt,
  })

  // 2. Start Receiving
  fastify.post('/:receiptId/start', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('warehouse_receipts.update'),
      requireWarehouseScope(),
    ],
    handler: controller.startReceiving,
  })

  // 3. Submit for QC Inspection
  fastify.post('/:receiptId/submit-qc', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('warehouse_receipts.update'),
      requireWarehouseScope(),
    ],
    handler: controller.submitForQc,
  })

  // 4. Perform Quality Control Inspection (Pass / Fail / Conditional)
  fastify.post('/:receiptId/qc', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('quality_control.inspect'),
    ],
    schema: { body: PerformQcSchema },
    handler: controller.performQcInspection,
  })

  // 5. Get Receipt by ID
  fastify.get('/:receiptId', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('warehouse_receipts.view'),
    ],
    handler: controller.getReceiptById,
  })

  // 6. List Receipts
  fastify.get('/', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('warehouse_receipts.view'),
    ],
    handler: controller.listReceipts,
  })
}

export default warehouseReceiptsRoutes
