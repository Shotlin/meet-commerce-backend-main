/**
 * Vendor KYC Routes — Fastify Plugin for Onboarding & KYC Endpoints
 * Source of truth: Blueprint §06.1, Phase 2B
 *
 * @module modules/vendors/vendor-kyc.routes
 */

import { VendorsRepository } from './vendors.repository.js'
import { VendorKycRepository } from './vendor-kyc.repository.js'
import { VendorKycService } from './vendor-kyc.service.js'
import { VendorKycController } from './vendor-kyc.controller.js'
import { SubmitKycSchema, ReviewKycSchema } from './vendor-kyc.schema.js'
import { requireVendorScope } from '../../middlewares/vendor-scope.js'

export async function vendorKycRoutes(fastify) {
  const vendorRepository = new VendorsRepository()
  const kycRepository = new VendorKycRepository()
  const service = new VendorKycService(vendorRepository, kycRepository)
  const controller = new VendorKycController(service)

  // 1. Submit KYC documents (Vendor scope)
  fastify.post('/:vendorId/kyc', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('vendors.update'),
      requireVendorScope(),
    ],
    schema: { body: SubmitKycSchema },
    handler: controller.submitKyc,
  })

  // 2. Review KYC (Admin / Compliance)
  fastify.post('/:vendorId/kyc/review', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('vendor_documents.verify'),
    ],
    schema: { body: ReviewKycSchema },
    handler: controller.reviewKyc,
  })

  // 3. Get onboarding status & review history
  fastify.get('/:vendorId/kyc/status', {
    preHandler: [
      fastify.authenticate,
      fastify.requirePermission('vendor_documents.view'),
      requireVendorScope(),
    ],
    handler: controller.getOnboardingStatus,
  })
}

export default vendorKycRoutes
