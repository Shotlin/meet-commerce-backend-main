/**
 * Vendor Controller — HTTP Handler Layer for Vendor Domain
 * Source of truth: Blueprint §06.1, Phase 2A
 *
 * @module modules/vendors/vendors.controller
 */

export class VendorsController {
  /**
   * @param {import('./vendors.service.js').VendorsService} service
   */
  constructor(service) {
    this.service = service
  }

  create = async (req, reply) => {
    const vendor = await this.service.createVendor(req.body)
    return reply.status(201).send({ success: true, data: vendor })
  }

  getById = async (req, reply) => {
    const { vendorId } = req.params
    const vendor = await this.service.getVendorById(vendorId)
    return reply.status(200).send({ success: true, data: vendor })
  }

  update = async (req, reply) => {
    const { vendorId } = req.params
    const updated = await this.service.updateVendor(vendorId, req.body)
    return reply.status(200).send({ success: true, data: updated })
  }

  updateStatus = async (req, reply) => {
    const { vendorId } = req.params
    const { status, reason } = req.body
    const updated = await this.service.updateVendorStatus(vendorId, status, reason)
    return reply.status(200).send({ success: true, data: updated })
  }

  delete = async (req, reply) => {
    const { vendorId } = req.params
    await this.service.deleteVendor(vendorId)
    return reply.status(200).send({ success: true, message: 'Vendor deleted successfully' })
  }

  list = async (req, reply) => {
    const result = await this.service.listVendors(req.query)
    return reply.status(200).send({ success: true, ...result })
  }

  updateProfile = async (req, reply) => {
    const { vendorId } = req.params
    const updated = await this.service.updateProfile(vendorId, req.body)
    return reply.status(200).send({ success: true, data: updated })
  }

  updateSettings = async (req, reply) => {
    const { vendorId } = req.params
    const updated = await this.service.updateSettings(vendorId, req.body)
    return reply.status(200).send({ success: true, data: updated })
  }
}
