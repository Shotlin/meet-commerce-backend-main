import { AdminRidersController } from './riders.controller.js'
import { AdminRidersRepository } from './riders.repository.js'
import {
  listRidersSchema, riderIdSchema, riderEarningsSchema,
  createPayoutSchema, toggleSuspendSchema, approveRiderSchema, updateCommissionSchema, verifyDocumentSchema,
  getStoreAssignmentsSchema, replaceStoreAssignmentsSchema, setMyShopAssignmentSchema, searchByPhoneSchema,
  riderCollectionsSchema, createSettlementSchema, setBusinessUpiSchema,
} from './riders.schema.js'
import { requirePermission } from '../../../middlewares/permission-check.js'
import { requireShopScope } from '../../../middlewares/shop-scope.js'
import {
  listRequiresGlobalView, canActOnRider, isHqOnlyActionAllowed, hasResolvedShopForAssignment,
} from './riders.authorization.js'

const ctrl = new AdminRidersController()
const repo = new AdminRidersRepository()

/**
 * Authorization model (rewritten 2026-09-28 — was HQ-only via a blanket
 * `fastify.requireAdmin` hook, which blocked every shop-staff caller
 * regardless of their own already-granted `riders.*` permissions —
 * SHOP_ADMIN/SHOP_MANAGER have always had `riders.view`/`riders.assign`/
 * `riders.approve`/`riders.manage` via `SHOP_SCOPED_PERMISSIONS` in
 * `utils/permissions.js`, the route layer just never checked them).
 * The actual allow/deny decisions live in `riders.authorization.js` as
 * pure functions (directly unit-tested); this file only wires them to
 * Fastify preHandlers:
 *
 *   - Every route: `fastify.authenticate` + `requireShopScope({requireShop:
 *     false})` — resolves `request.shopId` from a shop-staff JWT, or an
 *     HQ caller's optional X-Shop-Id header; `null` for HQ with no shop
 *     selected (the original, still-supported "global roster" mode).
 *   - Each route then requires the matching canonical `riders.*`
 *     permission via `requirePermission` (works for BOTH an HQ JWT via
 *     `platform_role` and a shop-staff JWT via its `permissions` claim —
 *     see middlewares/permission-check.js).
 *   - A rider-scoped route (`/:id/...`) additionally runs
 *     `requireRiderOwnership`: a shop-scoped caller may only act on a
 *     rider that already holds an ACTIVE `rider_store_assignments` row
 *     for their own shop; an HQ caller (no shop scope) is unrestricted,
 *     exactly as before this change.
 *   - A handful of genuinely rider-wide, HQ-only actions (bank payouts,
 *     the global commission rate, and the full store-assignment
 *     REPLACE, which can silently deactivate a DIFFERENT shop's
 *     assignment) stay HQ-only via `requireHqOnly` — a shop manager
 *     uses the new single-shop `PUT /:id/my-shop-assignment` instead of
 *     the full-replace endpoint, which can never touch a shop it
 *     doesn't own.
 *   - New `GET /search-by-phone` is the "add a rider" lookup: a bounded,
 *     exact-phone-number search (never a roster browse) available to
 *     both HQ and shop-scoped callers holding `riders.assign`.
 */
export default async function adminRiderRoutes(fastify) {
  fastify.addHook('preHandler', fastify.authenticate)
  fastify.addHook('preHandler', requireShopScope({ requireShop: false }))

  const requireRidersView = requirePermission('riders.view')
  const requireRidersAssign = requirePermission('riders.assign')
  const requireRidersApprove = requirePermission('riders.approve')
  const requireRidersManage = requirePermission('riders.manage')
  const requireGlobalView = requirePermission('reports.global_view')

  const requireListAccess = async function requireListAccess(request, reply) {
    await requireRidersView(request, reply)
    if (reply.sent) return
    if (listRequiresGlobalView(request.shopId)) {
      await requireGlobalView(request, reply)
    }
  }

  const requireRiderOwnership = async function requireRiderOwnership(request, reply) {
    const shopId = request.shopId || null
    const riderHasActiveAssignment = shopId
      ? await repo.hasActiveAssignment(request.params.id, shopId)
      : false
    if (!canActOnRider({ shopId, riderHasActiveAssignment })) {
      return reply.code(403).send({
        success: false,
        message: 'Forbidden — rider is not assigned to your shop',
        code: 'CROSS_SHOP_ACCESS_DENIED',
      })
    }
  }

  const requireHqOnly = async function requireHqOnly(request, reply) {
    if (!isHqOnlyActionAllowed(request.shopId || null)) {
      return reply.code(403).send({
        success: false,
        message: 'Forbidden — this action requires HQ access',
        code: 'FORBIDDEN',
      })
    }
  }

  const requireResolvedShop = async function requireResolvedShop(request, reply) {
    if (!hasResolvedShopForAssignment(request.shopId || null)) {
      return reply.code(400).send({
        success: false,
        message: 'Select a shop before assigning a rider to it',
        code: 'SHOP_SCOPE_REQUIRED',
      })
    }
  }

  fastify.get('/', { schema: listRidersSchema, preHandler: [requireListAccess] }, ctrl.list)

  fastify.get('/live-locations', { preHandler: [requireRidersView] }, ctrl.getLiveLocations)

  fastify.get('/search-by-phone', {
    schema: searchByPhoneSchema,
    preHandler: [requireRidersAssign],
  }, ctrl.searchByPhone)

  fastify.get('/:id', { schema: riderIdSchema, preHandler: [requireRidersView, requireRiderOwnership] }, ctrl.getDetail)
  fastify.get('/:id/earnings', { schema: riderEarningsSchema, preHandler: [requireRidersView, requireRiderOwnership] }, ctrl.getEarnings)

  // Bank payouts — a rider-wide payroll action, stays HQ-only.
  fastify.get('/:id/payouts', { schema: riderIdSchema, preHandler: [requireRidersManage, requireHqOnly] }, ctrl.getPayouts)
  fastify.post('/:id/payouts', { schema: createPayoutSchema, preHandler: [requireRidersManage, requireHqOnly] }, ctrl.createPayout)

  fastify.put('/:id/suspend', { schema: toggleSuspendSchema, preHandler: [requireRidersManage, requireRiderOwnership] }, ctrl.toggleSuspend)
  fastify.put('/:id/approve', { schema: approveRiderSchema, preHandler: [requireRidersApprove, requireRiderOwnership] }, ctrl.approveRider)

  // Global commission rate — affects the rider platform-wide, stays HQ-only.
  fastify.put('/:id/commission', { schema: updateCommissionSchema, preHandler: [requireRidersManage, requireHqOnly] }, ctrl.updateCommission)

  fastify.get('/:id/documents', { schema: riderIdSchema, preHandler: [requireRidersView, requireRiderOwnership] }, ctrl.getDocuments)
  fastify.put('/:id/documents/:documentId/verify', { schema: verifyDocumentSchema, preHandler: [requireRidersApprove, requireRiderOwnership] }, ctrl.verifyDocument)

  // Big Phase 6: store eligibility — admins mark which FreshCuts
  // stores a rider may receive offers for (consulted by dispatch when
  // RIDER_STORE_SCOPING=true).
  fastify.get('/:id/assignments', { schema: getStoreAssignmentsSchema, preHandler: [requireRidersView, requireRiderOwnership] }, ctrl.getStoreAssignments)
  // Full replace can deactivate a DIFFERENT shop's assignment — HQ only.
  fastify.put('/:id/assignments', { schema: replaceStoreAssignmentsSchema, preHandler: [requireRidersAssign, requireHqOnly] }, ctrl.replaceStoreAssignments)
  // Shop-scoped counterpart: touches only the caller's own shop.
  fastify.put('/:id/my-shop-assignment', { schema: setMyShopAssignmentSchema, preHandler: [requireRidersAssign, requireResolvedShop] }, ctrl.setMyShopAssignment)

  // Big Phase 14: COD cash ledger + settlement reconciliation
  fastify.get('/:id/collections', { schema: riderCollectionsSchema, preHandler: [requireRidersView, requireRiderOwnership] }, ctrl.getCollections)
  fastify.get('/:id/settlements', { schema: riderCollectionsSchema, preHandler: [requireRidersView, requireRiderOwnership] }, ctrl.getSettlements)
  fastify.post('/:id/settlements', { schema: createSettlementSchema, preHandler: [requireRidersManage, requireRiderOwnership] }, ctrl.createSettlement)
  fastify.put('/:id/business-upi', { schema: setBusinessUpiSchema, preHandler: [requireRidersManage, requireRiderOwnership] }, ctrl.setBusinessUpi)

  // Task 12.4: POST /api/v1/admin/riders/:riderId/approve — requires riders.approve
  fastify.post('/:id/approve', {
    schema: riderIdSchema,
    preHandler: [requireRidersApprove, requireRiderOwnership],
  }, ctrl.approveRiderStatus)
}
