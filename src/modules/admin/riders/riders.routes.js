import { AdminRidersController } from './riders.controller.js'
import {
  listRidersSchema, riderIdSchema, riderEarningsSchema,
  createPayoutSchema, toggleSuspendSchema, approveRiderSchema, updateCommissionSchema, verifyDocumentSchema,
  getStoreAssignmentsSchema, replaceStoreAssignmentsSchema,
  riderCollectionsSchema, createSettlementSchema, setBusinessUpiSchema,
} from './riders.schema.js'
import { requirePermission } from '../../../middlewares/permission-check.js'

const ctrl = new AdminRidersController()

export default async function adminRiderRoutes(fastify) {
  fastify.addHook('preHandler', async (request, reply) => {
    await fastify.authenticate(request, reply)
    await fastify.requireAdmin(request, reply)
  })

  // Task 12.5: GET /api/v1/admin/riders — requires riders.view AND reports.global_view
  fastify.get('/', {
    schema: listRidersSchema,
    preHandler: [requirePermission('riders.view'), requirePermission('reports.global_view')],
  }, ctrl.list)

  fastify.get('/live-locations', ctrl.getLiveLocations)
  fastify.get('/:id', { schema: riderIdSchema }, ctrl.getDetail)
  fastify.get('/:id/earnings', { schema: riderEarningsSchema }, ctrl.getEarnings)
  fastify.get('/:id/payouts', { schema: riderIdSchema }, ctrl.getPayouts)
  fastify.post('/:id/payouts', { schema: createPayoutSchema }, ctrl.createPayout)
  fastify.put('/:id/suspend', { schema: toggleSuspendSchema }, ctrl.toggleSuspend)
  fastify.put('/:id/approve', { schema: approveRiderSchema }, ctrl.approveRider)
  fastify.put('/:id/commission', { schema: updateCommissionSchema }, ctrl.updateCommission)
  fastify.get('/:id/documents', { schema: riderIdSchema }, ctrl.getDocuments)
  fastify.put('/:id/documents/:documentId/verify', { schema: verifyDocumentSchema }, ctrl.verifyDocument)

  // Big Phase 6: store eligibility — admins mark which FreshCuts
  // stores a rider may receive offers for (consulted by dispatch when
  // RIDER_STORE_SCOPING=true).
  fastify.get('/:id/assignments', { schema: getStoreAssignmentsSchema }, ctrl.getStoreAssignments)
  fastify.put('/:id/assignments', { schema: replaceStoreAssignmentsSchema }, ctrl.replaceStoreAssignments)

  // Big Phase 14: COD cash ledger + settlement reconciliation
  fastify.get('/:id/collections', { schema: riderCollectionsSchema }, ctrl.getCollections)
  fastify.get('/:id/settlements', { schema: riderCollectionsSchema }, ctrl.getSettlements)
  fastify.post('/:id/settlements', { schema: createSettlementSchema }, ctrl.createSettlement)
  fastify.put('/:id/business-upi', { schema: setBusinessUpiSchema }, ctrl.setBusinessUpi)

  // Task 12.4: POST /api/v1/admin/riders/:riderId/approve — requires riders.approve
  fastify.post('/:id/approve', {
    schema: riderIdSchema,
    preHandler: [requirePermission('riders.approve')],
  }, ctrl.approveRiderStatus)
}
