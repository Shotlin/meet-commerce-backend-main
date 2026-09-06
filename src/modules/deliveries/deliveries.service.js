/**
 * Deliveries Service — Rider Shift Management & Delivery Adaptation Engine
 * Source of truth: Blueprint §06.8, Phase 9
 *
 * @module modules/deliveries/deliveries.service
 */

import { logger } from '../../config/logger.js'

const ALLOWED_DELIVERY_TRANSITIONS = {
  ASSIGNED: ['PICKED_UP', 'CANCELLED', 'FAILED'],
  PICKED_UP: ['IN_TRANSIT', 'FAILED', 'CANCELLED'],
  IN_TRANSIT: ['DELIVERED', 'FAILED', 'CANCELLED'],
  DELIVERED: [],
  FAILED: [],
  CANCELLED: [],
}

export class DeliveriesService {
  /**
   * @param {import('./deliveries.repository.js').DeliveriesRepository} repository
   * @param {import('../orders/orders.repository.js').OrdersRepository} ordersRepository
   */
  constructor(repository, ordersRepository) {
    this.repository = repository
    this.ordersRepository = ordersRepository
  }

  // ─── RIDER & SHIFT MANAGEMENT ─────────────────────
  async createRider(payload) {
    const { user_id, vehicle_type = 'BIKE', license_number = null } = payload
    const existing = await this.repository.findRiderByUserId(user_id)
    if (existing) {
      const err = new Error('Rider profile already exists for this user')
      err.statusCode = 409
      err.code = 'DUPLICATE_RIDER_PROFILE'
      throw err
    }

    const rider = await this.repository.createRider(user_id, vehicle_type, license_number)
    logger.info({ riderId: rider.id, user_id }, 'Rider profile created')
    return rider
  }

  async startShift(riderId) {
    const rider = await this.repository.findRiderById(riderId)
    if (!rider || !rider.is_active) {
      const err = new Error('Rider is inactive or not found')
      err.statusCode = 400
      err.code = 'INACTIVE_RIDER_REJECTED'
      throw err
    }

    const activeShift = await this.repository.findActiveShift(riderId)
    if (activeShift) {
      const err = new Error('Rider already has an active shift in progress')
      err.statusCode = 409
      err.code = 'OVERLAPPING_SHIFT_REJECTED'
      throw err
    }

    const shift = await this.repository.startShift(riderId)
    logger.info({ shiftId: shift.id, riderId }, 'Rider shift started')
    return shift
  }

  async updateShiftStatus(riderId, status) {
    const activeShift = await this.repository.findActiveShift(riderId)
    if (!activeShift) {
      const err = new Error('No active shift found for rider')
      err.statusCode = 404
      err.code = 'SHIFT_NOT_FOUND'
      throw err
    }

    const updated = await this.repository.updateShiftStatus(activeShift.id, status)
    logger.info({ shiftId: updated.id, status }, 'Rider shift status updated')
    return updated
  }

  // ─── DELIVERY ASSIGNMENT & STATUS WORKFLOW ─────────
  async assignDelivery(actorId, payload) {
    const { order_id, rider_id, notes = null } = payload

    const order = await this.ordersRepository.findOrderById(order_id)
    if (!order) {
      const err = new Error('Order not found')
      err.statusCode = 404
      err.code = 'ORDER_NOT_FOUND'
      throw err
    }

    const rider = await this.repository.findRiderById(rider_id)
    if (!rider || !rider.is_active || !rider.is_available) {
      const err = new Error('Rider is unavailable or off duty')
      err.statusCode = 400
      err.code = 'UNAVAILABLE_RIDER_REJECTED'
      throw err
    }

    // Check if order already has active assignment
    const activeAssignment = await this.repository.findActiveAssignmentByOrder(order_id)
    if (activeAssignment) {
      // Auto-cancel previous active assignment for reassignment
      await this.repository.updateAssignmentStatus(activeAssignment.id, 'CANCELLED', 'Reassigned to another rider')
      await this.repository.logStatusTransition(activeAssignment.id, activeAssignment.status, 'CANCELLED', actorId, 'Reassigned')
    }

    const assignment = await this.repository.createAssignment(order_id, rider_id, notes)
    await this.repository.logStatusTransition(assignment.id, null, 'ASSIGNED', actorId, notes)
    await this.repository.logAudit(assignment.id, actorId, 'ASSIGN_DELIVERY', { order_id, rider_id })

    logger.info({ assignmentId: assignment.id, order_id, rider_id }, 'Delivery assigned to rider')
    return assignment
  }

  async transitionDeliveryStatus(assignmentId, actorId, nextStatus, notes = null) {
    const assignment = await this.repository.findAssignmentById(assignmentId)
    if (!assignment) {
      const err = new Error('Delivery assignment not found')
      err.statusCode = 404
      err.code = 'ASSIGNMENT_NOT_FOUND'
      throw err
    }

    const allowed = ALLOWED_DELIVERY_TRANSITIONS[assignment.status] || []
    if (!allowed.includes(nextStatus)) {
      const err = new Error(`Invalid delivery transition from ${assignment.status} to ${nextStatus}`)
      err.statusCode = 400
      err.code = 'INVALID_DELIVERY_TRANSITION'
      throw err
    }

    const updated = await this.repository.updateAssignmentStatus(assignmentId, nextStatus, notes)
    await this.repository.logStatusTransition(assignmentId, assignment.status, nextStatus, actorId, notes)
    await this.repository.logAudit(assignmentId, actorId, 'TRANSITION_STATUS', { from: assignment.status, to: nextStatus, notes })

    // Auto-update parent Order status when delivery status reaches IN_TRANSIT or DELIVERED
    if (nextStatus === 'IN_TRANSIT') {
      await this.ordersRepository.updateOrderStatus(assignment.order_id, 'OUT_FOR_DELIVERY')
    } else if (nextStatus === 'DELIVERED') {
      await this.ordersRepository.updateOrderStatus(assignment.order_id, 'DELIVERED')
    }

    logger.info({ assignmentId, fromStatus: assignment.status, nextStatus }, 'Delivery status transitioned')
    return updated
  }

  async listRiders() {
    return this.repository.listRiders()
  }

  async listAssignments(params = {}) {
    return this.repository.listAssignments(params.riderId, params.status)
  }
}
