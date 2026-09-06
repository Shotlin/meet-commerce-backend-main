/**
 * Inventory Routes — Fastify Plugin for Inventory Lots & FEFO Reservations
 * Source of truth: Blueprint §06.5, Phase 6
 *
 * @module modules/inventory/inventory.routes
 */

import { InventoryRepository } from './inventory.repository.js'
import { InventoryService } from './inventory.service.js'
import { InventoryController } from './inventory.controller.js'
import { StockInboundSchema, ReserveFefoSchema, ReleaseReservationSchema, StockAdjustmentSchema } from './inventory.schema.js'
import { requireWarehouseScope } from '../../middlewares/warehouse-scope.js'

export async function inventoryRoutes(fastify) {
  const repository = new InventoryRepository()
  const service = new InventoryService(repository)
  const controller = new InventoryController(service)

  // 1. Stock Inbound
  fastify.post('/inbound', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('inventory.manage'),
      requireWarehouseScope(),
    ],
    schema: { body: StockInboundSchema },
    handler: controller.registerInbound,
  })

  // 2. Reserve FEFO
  fastify.post('/reserve', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('inventory.reserve'),
      requireWarehouseScope(),
    ],
    schema: { body: ReserveFefoSchema },
    handler: controller.reserveFefo,
  })

  // 3. Release Reservation
  fastify.post('/release', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('inventory.reserve'),
    ],
    schema: { body: ReleaseReservationSchema },
    handler: controller.releaseReservation,
  })

  // 4. Stock Adjustment
  fastify.post('/adjust', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('inventory.manage'),
      requireWarehouseScope(),
    ],
    schema: { body: StockAdjustmentSchema },
    handler: controller.adjustStock,
  })

  // 5. List Lots
  fastify.get('/lots', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('inventory.view'),
      requireWarehouseScope(),
    ],
    handler: controller.listLots,
  })

  // 6. Get Stock Ledger
  fastify.get('/ledger', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('inventory.view'),
      requireWarehouseScope(),
    ],
    handler: controller.getLedgerEntries,
  })
}

export default inventoryRoutes
