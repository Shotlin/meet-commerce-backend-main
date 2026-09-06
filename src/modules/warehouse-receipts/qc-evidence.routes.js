/**
 * QC Evidence Routes — Fastify Plugin for QC Evidence, Defects & Dispositions Endpoints
 * Source of truth: Blueprint §06.4, Phase 5B
 *
 * @module modules/warehouse-receipts/qc-evidence.routes
 */

import { QcEvidenceRepository } from './qc-evidence.repository.js'
import { QcEvidenceService } from './qc-evidence.service.js'
import { QcEvidenceController } from './qc-evidence.controller.js'
import { AddQcMediaSchema, AddDefectSchema, SubmitDispositionSchema } from './qc-evidence.schema.js'
import { requireWarehouseScope } from '../../middlewares/warehouse-scope.js'

export async function qcEvidenceRoutes(fastify) {
  const repository = new QcEvidenceRepository()
  const service = new QcEvidenceService(repository)
  const controller = new QcEvidenceController(service)

  // 1. Media Evidence
  fastify.post('/inspections/:inspectionId/media', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('quality_control.inspect'),
      requireWarehouseScope(),
    ],
    schema: { body: AddQcMediaSchema },
    handler: controller.addMedia,
  })

  fastify.get('/inspections/:inspectionId/media', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('quality_control.inspect'),
    ],
    handler: controller.getMedia,
  })

  // 2. Defects & Corrective Actions
  fastify.post('/inspections/:inspectionId/defects', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('quality_control.inspect'),
      requireWarehouseScope(),
    ],
    schema: { body: AddDefectSchema },
    handler: controller.addDefect,
  })

  fastify.get('/inspections/:inspectionId/defects', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('quality_control.inspect'),
    ],
    handler: controller.getDefects,
  })

  // 3. Dispositions Workflow (Accept / Rework / Return / Reject)
  fastify.post('/inspections/:inspectionId/disposition', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('quality_control.approve'),
      requireWarehouseScope(),
    ],
    schema: { body: SubmitDispositionSchema },
    handler: controller.submitDisposition,
  })

  fastify.get('/inspections/:inspectionId/dispositions', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('quality_control.inspect'),
    ],
    handler: controller.getDispositions,
  })
}

export default qcEvidenceRoutes
