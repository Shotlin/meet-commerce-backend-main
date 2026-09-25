/**
 * Vendor Routes — Fastify Plugin for Vendor Domain Endpoints
 * Source of truth: Blueprint §06.1, Phase 2A
 *
 * @module modules/vendors/vendors.routes
 */

import { VendorsRepository } from './vendors.repository.js'
import { VendorsService } from './vendors.service.js'
import { VendorsController } from './vendors.controller.js'
import {
  CreateVendorSchema,
  UpdateVendorSchema,
  UpdateVendorStatusSchema,
  UpdateVendorProfileSchema,
  UpdateVendorSettingsSchema,
  VendorQuerySchema,
} from './vendors.schema.js'
import { requireVendorScope } from '../../middlewares/vendor-scope.js'
import { requirePermission } from '../../middlewares/permission-check.js'

export async function vendorRoutes(fastify) {
  const repository = new VendorsRepository()
  const service = new VendorsService(repository)
  const controller = new VendorsController(service)

  // 1. Create new vendor (Admin / Onboarding)
  fastify.post('/', {
    preHandler: [fastify.authenticate, fastify.requirePermission('vendors.create')],
    schema: { body: CreateVendorSchema },
    handler: controller.create,
  })

  // 2. List & search vendors
  fastify.get('/', {
    preHandler: [fastify.authenticate, fastify.requirePermission('vendors.view')],
    schema: { querystring: VendorQuerySchema },
    handler: controller.list,
  })

  // 3. Get vendor by ID
  // NOTE: getById/update/updateProfile/updateSettings use
  // middlewares/permission-check.js#requirePermission, NOT
  // fastify.requirePermission — the fastify decorator (auth.plugin.js)
  // recomputes the effective permission set from
  // ROLE_PERMISSIONS[request.user.platform_role || request.user.role],
  // which for a vendor-scoped JWT resolves to the base 'CUSTOMER' role
  // (vendors have no platform_role, and `role` is the underlying users
  // row's role, not their vendor role) — it silently ignores the real
  // `vendorRoles`/`permissions` claims the login flow puts on the JWT
  // specifically for vendor use. Found live: every vendor self-service
  // call 403'd with "requires 'vendors.view' permission" despite the
  // JWT genuinely carrying it. `middlewares/permission-check.js`'s
  // variant correctly reads `user.permissions` directly for a non-HQ
  // caller (computeEffectivePermissions) — the same fix already applied
  // to modules/vendor-procurement's vendor-facing routes.
  fastify.get('/:vendorId', {
    preHandler: [
      fastify.authenticate,
      requirePermission('vendors.view'),
      requireVendorScope(),
    ],
    handler: controller.getById,
  })

  // 4. Update vendor details
  fastify.patch('/:vendorId', {
    preHandler: [
      fastify.authenticate,
      requirePermission('vendors.update'),
      requireVendorScope(),
    ],
    schema: { body: UpdateVendorSchema },
    handler: controller.update,
  })

  // 5. Update vendor status (Activate / Suspend / Verify)
  // Deliberately LEFT on fastify.requirePermission (unlike 3/4/7/8 above)
  // — see the spawned task on VENDOR_OWNER's role permissions before ever
  // switching this one. VENDOR_OWNER's real ROLE_PERMISSIONS set already
  // includes 'vendors.suspend', so swapping this to the correct
  // JWT-reading middleware without first fixing that role definition (or
  // adding requireVendorScope here) would let any vendor suspend/delete
  // any OTHER vendor by ID — right now that's accidentally blocked only
  // because this route's permission check doesn't read the JWT's real
  // permissions at all.
  fastify.patch('/:vendorId/status', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('vendors.suspend'),
    ],
    schema: { body: UpdateVendorStatusSchema },
    handler: controller.updateStatus,
  })

  // 6. Soft delete vendor — same deliberate exception as #5 above.
  fastify.delete('/:vendorId', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('vendors.suspend'),
    ],
    handler: controller.delete,
  })

  // 7. Update vendor profile (KYC & Address)
  fastify.patch('/:vendorId/profile', {
    preHandler: [
      fastify.authenticate,
      requirePermission('vendors.update'),
      requireVendorScope(),
    ],
    schema: { body: UpdateVendorProfileSchema },
    handler: controller.updateProfile,
  })

  // 8. Update vendor settings (Operating Config & Financials)
  fastify.patch('/:vendorId/settings', {
    preHandler: [
      fastify.authenticate,
      requirePermission('vendors.update'),
      requireVendorScope(),
    ],
    schema: { body: UpdateVendorSettingsSchema },
    handler: controller.updateSettings,
  })
}

export default vendorRoutes
