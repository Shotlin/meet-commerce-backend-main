/**
 * Support & Traceability Controller — HTTP Handlers
 * Source of truth: Blueprint §06.9, Phase 10
 *
 * @module modules/support/support.controller
 */

export class SupportController {
  /**
   * @param {import('./support.service.js').SupportService} service
   */
  constructor(service) {
    this.service = service
  }

  createTicket = async (req, reply) => {
    const userId = req.userId || req.user.id
    const ticket = await this.service.createTicket(userId, req.body)
    return reply.status(201).send({ success: true, data: ticket })
  }

  assignTicket = async (req, reply) => {
    const { ticketId } = req.params
    const actorId = req.userId || req.user.id
    const updated = await this.service.assignTicket(ticketId, actorId, req.body.assigned_to)
    return reply.status(200).send({ success: true, data: updated })
  }

  updateTicketStatus = async (req, reply) => {
    const { ticketId } = req.params
    const actorId = req.userId || req.user.id
    const updated = await this.service.updateTicketStatus(ticketId, actorId, req.body.status, req.body.notes)
    return reply.status(200).send({ success: true, data: updated })
  }

  addTicketComment = async (req, reply) => {
    const { ticketId } = req.params
    const userId = req.userId || req.user.id
    const comment = await this.service.addTicketComment(ticketId, userId, req.body.comment)
    return reply.status(201).send({ success: true, data: comment })
  }

  getTicketById = async (req, reply) => {
    const { ticketId } = req.params
    const ticket = await this.service.getTicketById(ticketId)
    return reply.status(200).send({ success: true, data: ticket })
  }

  listTickets = async (req, reply) => {
    const userId = req.user?.platform_role === 'CUSTOMER' ? (req.userId || req.user.id) : null
    const tickets = await this.service.listTickets(userId)
    return reply.status(200).send({ success: true, data: tickets })
  }

  createRecall = async (req, reply) => {
    const initiatedBy = req.userId || req.user.id
    const recall = await this.service.createRecall(initiatedBy, req.body)
    return reply.status(201).send({ success: true, data: recall })
  }

  updateRecallStatus = async (req, reply) => {
    const { recallId } = req.params
    const updated = await this.service.updateRecallStatus(recallId, req.body.status)
    return reply.status(200).send({ success: true, data: updated })
  }

  listRecalls = async (req, reply) => {
    const recalls = await this.service.listRecalls()
    return reply.status(200).send({ success: true, data: recalls })
  }

  quarantineRecall = async (req, reply) => {
    const { recallId } = req.params
    const actorId = req.userId || req.user.id
    const updated = await this.service.quarantineRecall(recallId, actorId)
    return reply.status(200).send({ success: true, data: updated })
  }

  notifyTaskforce = async (req, reply) => {
    const { recallId } = req.params
    const result = await this.service.notifyTaskforce(recallId)
    return reply.status(200).send({ success: true, message: 'Quality taskforce notified', data: result })
  }

  getTraceabilityHistory = async (req, reply) => {
    const { productId } = req.params
    const batchNumber = req.query.batch_number || null
    const history = await this.service.getTraceabilityHistory(productId, batchNumber)
    return reply.status(200).send({ success: true, data: history })
  }
}
