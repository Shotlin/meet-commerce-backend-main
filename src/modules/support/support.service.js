/**
 * Support & Traceability Service — Business Logic Engine
 * Source of truth: Blueprint §06.9, Phase 10
 *
 * @module modules/support/support.service
 */

import crypto from 'node:crypto'
import { logger } from '../../config/logger.js'

export class SupportService {
  /**
   * @param {import('./support.repository.js').SupportRepository} repository
   */
  constructor(repository) {
    this.repository = repository
  }

  // ─── TICKETS ────────────────────────────────────────
  async createTicket(userId, payload) {
    const { subject, description } = payload
    const ticketNumber = `TICK-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`
    const ticket = await this.repository.createTicket(ticketNumber, userId, subject, description)

    await this.repository.logStatusTransition(ticket.id, null, 'OPEN', userId, 'Ticket created')
    logger.info({ ticketId: ticket.id, ticketNumber, userId }, 'Support ticket created')
    return ticket
  }

  async assignTicket(ticketId, actorId, assignedTo) {
    const ticket = await this.repository.findTicketById(ticketId)
    if (!ticket) {
      const err = new Error('Support ticket not found')
      err.statusCode = 404
      err.code = 'TICKET_NOT_FOUND'
      throw err
    }

    if (ticket.status === 'CLOSED') {
      const err = new Error('Cannot assign closed support ticket')
      err.statusCode = 400
      err.code = 'TICKET_CLOSED_LOCKED'
      throw err
    }

    const updated = await this.repository.assignTicket(ticketId, assignedTo)
    await this.repository.logStatusTransition(ticketId, ticket.status, updated.status, actorId, `Assigned to ${assignedTo}`)
    return updated
  }

  async updateTicketStatus(ticketId, actorId, status, notes = null) {
    const ticket = await this.repository.findTicketById(ticketId)
    if (!ticket) {
      const err = new Error('Support ticket not found')
      err.statusCode = 404
      err.code = 'TICKET_NOT_FOUND'
      throw err
    }

    if (ticket.status === 'CLOSED' && status !== 'REOPENED') {
      const err = new Error('Closed support tickets cannot be modified except to REOPEN')
      err.statusCode = 400
      err.code = 'TICKET_CLOSED_LOCKED'
      throw err
    }

    const updated = await this.repository.updateTicketStatus(ticketId, status)
    await this.repository.logStatusTransition(ticketId, ticket.status, status, actorId, notes)
    logger.info({ ticketId, fromStatus: ticket.status, toStatus: status }, 'Ticket status updated')
    return updated
  }

  async addTicketComment(ticketId, userId, commentText) {
    const ticket = await this.repository.findTicketById(ticketId)
    if (!ticket) {
      const err = new Error('Support ticket not found')
      err.statusCode = 404
      err.code = 'TICKET_NOT_FOUND'
      throw err
    }

    if (ticket.status === 'CLOSED') {
      const err = new Error('Cannot add comments to a closed support ticket')
      err.statusCode = 400
      err.code = 'TICKET_CLOSED_LOCKED'
      throw err
    }

    const comment = await this.repository.addTicketComment(ticketId, userId, commentText)
    return comment
  }

  async getTicketById(ticketId) {
    const ticket = await this.repository.findTicketById(ticketId)
    if (!ticket) {
      const err = new Error('Support ticket not found')
      err.statusCode = 404
      err.code = 'TICKET_NOT_FOUND'
      throw err
    }
    return ticket
  }

  async listTickets(userId = null) {
    return this.repository.listTickets(userId)
  }

  // ─── RECALLS ────────────────────────────────────────
  async createRecall(initiatedBy, payload) {
    const { title, reason, items = [] } = payload
    const recallNumber = `RECALL-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`
    const recall = await this.repository.createRecall(recallNumber, title, reason, initiatedBy)

    const recallItems = []
    for (const itemData of items) {
      const item = await this.repository.addRecallItem(
        recall.id,
        itemData.product_id,
        itemData.batch_id || null,
        itemData.batch_number || null,
        itemData.affected_quantity || 0
      )
      recallItems.push(item)

      // Automatically record traceability event for recall
      await this.repository.recordTraceabilityEvent({
        event_type: 'PRODUCT_RECALL_LINKED',
        product_id: itemData.product_id,
        batch_number: itemData.batch_number || null,
        recall_id: recall.id,
        actor_id: initiatedBy,
        payload: { recallNumber, title, affected_quantity: itemData.affected_quantity },
      })
    }

    logger.info({ recallId: recall.id, recallNumber, itemCount: recallItems.length }, 'Product recall created')
    return { ...recall, items: recallItems }
  }

  async updateRecallStatus(recallId, status) {
    const recall = await this.repository.findRecallById(recallId)
    if (!recall) {
      const err = new Error('Product recall not found')
      err.statusCode = 404
      err.code = 'RECALL_NOT_FOUND'
      throw err
    }

    const updated = await this.repository.updateRecallStatus(recallId, status)
    return updated
  }

  async listRecalls() {
    return this.repository.listRecalls()
  }

  async quarantineRecall(recallId, actorId) {
    const recall = await this.repository.findRecallById(recallId)
    if (!recall) {
      const err = new Error('Product recall not found')
      err.statusCode = 404
      err.code = 'RECALL_NOT_FOUND'
      throw err
    }

    await this.repository.updateRecallStatus(recallId, 'ACTIVE')
    for (const item of recall.items) {
      await this.repository.recordTraceabilityEvent({
        event_type: 'RECALL_QUARANTINE_ISSUED',
        product_id: item.product_id,
        batch_number: item.batch_number,
        recall_id: recallId,
        actor_id: actorId,
        payload: { affected_quantity: item.affected_quantity },
      })
    }
    logger.info({ recallId, itemCount: recall.items.length }, 'Emergency quarantine issued for recall')
    // Re-read via the list-shaped query so the response carries lot_number
    // / affected_units the same way GET /recalls does (the dashboard swaps
    // this response into its list in place).
    return this.repository.listRecalls(recallId)
  }

  async notifyTaskforce(recallId) {
    const recall = await this.repository.findRecallById(recallId)
    if (!recall) {
      const err = new Error('Product recall not found')
      err.statusCode = 404
      err.code = 'RECALL_NOT_FOUND'
      throw err
    }
    logger.info({ recallId, recallNumber: recall.recall_number }, 'Quality taskforce notified for recall')
    return { recallId, notified: true }
  }

  // ─── TRACEABILITY ───────────────────────────────────
  async recordTraceabilityEvent(actorId, payload) {
    return this.repository.recordTraceabilityEvent({ ...payload, actor_id: actorId })
  }

  async getTraceabilityHistory(productId, batchNumber = null) {
    return this.repository.getTraceabilityHistory(productId, batchNumber)
  }
}
