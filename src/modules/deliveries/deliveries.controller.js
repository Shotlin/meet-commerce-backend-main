/**
 * Deliveries Controller — HTTP Handler Layer for Rider Shifts & Deliveries
 * Source of truth: Blueprint §06.8, Phase 9
 *
 * @module modules/deliveries/deliveries.controller
 */

export class DeliveriesController {
  /**
   * @param {import('./deliveries.service.js').DeliveriesService} service
   */
  constructor(service) {
    this.service = service
  }

  createRider = async (req, reply) => {
    const rider = await this.service.createRider(req.body)
    return reply.status(201).send({ success: true, data: rider })
  }

  startShift = async (req, reply) => {
    const { riderId } = req.params
    const shift = await this.service.startShift(riderId)
    return reply.status(201).send({ success: true, data: shift })
  }

  updateShiftStatus = async (req, reply) => {
    const { riderId } = req.params
    const shift = await this.service.updateShiftStatus(riderId, req.body.status)
    return reply.status(200).send({ success: true, data: shift })
  }

  assignDelivery = async (req, reply) => {
    const actorId = req.userId || req.user.id
    const assignment = await this.service.assignDelivery(actorId, req.body)
    return reply.status(201).send({ success: true, data: assignment })
  }

  transitionDeliveryStatus = async (req, reply) => {
    const { assignmentId } = req.params
    const actorId = req.userId || req.user.id
    const updated = await this.service.transitionDeliveryStatus(assignmentId, actorId, req.body.status, req.body.notes)
    return reply.status(200).send({ success: true, data: updated })
  }

  listRiders = async (req, reply) => {
    const riders = await this.service.listRiders()
    return reply.status(200).send({ success: true, data: riders })
  }

  listAssignments = async (req, reply) => {
    const assignments = await this.service.listAssignments({
      riderId: req.query.rider_id || null,
      status: req.query.status || null,
    })
    return reply.status(200).send({ success: true, data: assignments })
  }
}
