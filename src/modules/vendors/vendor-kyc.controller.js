/**
 * Vendor KYC Controller — HTTP Handler Layer for Onboarding & KYC Workflow
 * Source of truth: Blueprint §06.1, Phase 2B
 *
 * @module modules/vendors/vendor-kyc.controller
 */

export class VendorKycController {
  /**
   * @param {import('./vendor-kyc.service.js').VendorKycService} service
   */
  constructor(service) {
    this.service = service
  }

  submitKyc = async (req, reply) => {
    const { vendorId } = req.params
    const result = await this.service.submitKyc(vendorId, req.body)
    return reply.status(200).send({ success: true, data: result })
  }

  reviewKyc = async (req, reply) => {
    const { vendorId } = req.params
    const reviewerId = req.userId || req.user.id
    const result = await this.service.reviewKyc(vendorId, reviewerId, req.body)
    return reply.status(200).send({ success: true, data: result })
  }

  getOnboardingStatus = async (req, reply) => {
    const { vendorId } = req.params
    const result = await this.service.getOnboardingStatus(vendorId)
    return reply.status(200).send({ success: true, data: result })
  }
}
