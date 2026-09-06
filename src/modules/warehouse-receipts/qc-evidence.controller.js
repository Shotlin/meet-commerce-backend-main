/**
 * QC Evidence Controller — HTTP Handler Layer for QC Evidence, Defects & Dispositions
 * Source of truth: Blueprint §06.4, Phase 5B
 *
 * @module modules/warehouse-receipts/qc-evidence.controller
 */

export class QcEvidenceController {
  /**
   * @param {import('./qc-evidence.service.js').QcEvidenceService} service
   */
  constructor(service) {
    this.service = service
  }

  addMedia = async (req, reply) => {
    const { inspectionId } = req.params
    const warehouseId = req.warehouseId || req.user.warehouseId
    const userId = req.userId || req.user.id
    const media = await this.service.addMedia(inspectionId, warehouseId, userId, req.body)
    return reply.status(201).send({ success: true, data: media })
  }

  getMedia = async (req, reply) => {
    const { inspectionId } = req.params
    const media = await this.service.getMedia(inspectionId)
    return reply.status(200).send({ success: true, data: media })
  }

  addDefect = async (req, reply) => {
    const { inspectionId } = req.params
    const warehouseId = req.warehouseId || req.user.warehouseId
    const result = await this.service.addDefect(inspectionId, warehouseId, req.body)
    return reply.status(201).send({ success: true, data: result })
  }

  getDefects = async (req, reply) => {
    const { inspectionId } = req.params
    const defects = await this.service.getDefects(inspectionId)
    return reply.status(200).send({ success: true, data: defects })
  }

  submitDisposition = async (req, reply) => {
    const { inspectionId } = req.params
    const warehouseId = req.warehouseId || req.user.warehouseId
    const reviewerId = req.userId || req.user.id
    const disposition = await this.service.submitDisposition(inspectionId, warehouseId, reviewerId, req.body)
    return reply.status(201).send({ success: true, data: disposition })
  }

  getDispositions = async (req, reply) => {
    const { inspectionId } = req.params
    const dispositions = await this.service.getDispositions(inspectionId)
    return reply.status(200).send({ success: true, data: dispositions })
  }
}
