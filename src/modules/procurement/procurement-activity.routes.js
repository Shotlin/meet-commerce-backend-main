/**
 * Procurement Activity Routes — Fastify Plugin for Comments, Evidence & Timeline Endpoints
 * Source of truth: Blueprint §06.3, Phase 4B
 *
 * @module modules/procurement/procurement-activity.routes
 */

import { ProcurementRepository } from './procurement.repository.js'
import { ProcurementActivityRepository } from './procurement-activity.repository.js'
import { ProcurementActivityService } from './procurement-activity.service.js'
import { ProcurementActivityController } from './procurement-activity.controller.js'
import { AddCommentSchema, AddCategorizedMediaSchema } from './procurement-activity.schema.js'
import { requireVendorScope } from '../../middlewares/vendor-scope.js'

export async function procurementActivityRoutes(fastify) {
  const procurementRepository = new ProcurementRepository()
  const repository = new ProcurementActivityRepository()
  const service = new ProcurementActivityService(repository, procurementRepository)
  const controller = new ProcurementActivityController(service)

  // 1. Comments
  fastify.post('/:orderId/comments', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('procurement.update'),
      requireVendorScope(),
    ],
    schema: { body: AddCommentSchema },
    handler: controller.addComment,
  })

  fastify.get('/:orderId/comments', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('procurement.view'),
    ],
    handler: controller.getComments,
  })

  // 2. Categorized Evidence
  fastify.post('/:orderId/evidence', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('procurement.update'),
      requireVendorScope(),
    ],
    schema: { body: AddCategorizedMediaSchema },
    handler: controller.addCategorizedMedia,
  })

  fastify.get('/:orderId/evidence', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('procurement.view'),
    ],
    handler: controller.getCategorizedMedia,
  })

  // 3. Combined Audit & Activity Timeline
  fastify.get('/:orderId/timeline', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('procurement.view'),
    ],
    handler: controller.getAuditTimeline,
  })
}

export default procurementActivityRoutes
