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
  fastify.get('/:vendorId', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('vendors.view'),
      requireVendorScope(),
    ],
    handler: controller.getById,
  })

  // 4. Update vendor details
  fastify.patch('/:vendorId', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('vendors.update'),
      requireVendorScope(),
    ],
    schema: { body: UpdateVendorSchema },
    handler: controller.update,
  })

  // 5. Update vendor status (Activate / Suspend / Verify)
  fastify.patch('/:vendorId/status', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('vendors.suspend'),
    ],
    schema: { body: UpdateVendorStatusSchema },
    handler: controller.updateStatus,
  })

  // 6. Soft delete vendor
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
      fastify.requirePermission('vendors.update'),
      requireVendorScope(),
    ],
    schema: { body: UpdateVendorProfileSchema },
    handler: controller.updateProfile,
  })

  // 8. Update vendor settings (Operating Config & Financials)
  fastify.patch('/:vendorId/settings', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('vendors.update'),
      requireVendorScope(),
    ],
    schema: { body: UpdateVendorSettingsSchema },
    handler: controller.updateSettings,
  })
}

export default vendorRoutes
