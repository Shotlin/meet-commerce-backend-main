/**
 * Deliveries Repository — Data Access Layer for Riders, Shifts & Delivery Assignments
 * Source of truth: Blueprint §06.8, Phase 9
 *
 * @module modules/deliveries/deliveries.repository
 */

import { query } from '../../config/database.js'

export class DeliveriesRepository {
  // ─── RIDERS ─────────────────────────────────────────
  async createRider(userId, vehicleType = 'BIKE', licenseNumber = null) {
    const { rows } = await query(
      `INSERT INTO riders (user_id, vehicle_type, license_number, is_active, is_available)
       VALUES ($1, $2, $3, true, false)
       RETURNING *`,
      [userId, vehicleType, licenseNumber]
    )
    return rows[0]
  }

  async findRiderById(riderId) {
    const { rows } = await query(`SELECT * FROM riders WHERE id = $1 LIMIT 1`, [riderId])
    return rows[0] || null
  }

  async findRiderByUserId(userId) {
    const { rows } = await query(`SELECT * FROM riders WHERE user_id = $1 LIMIT 1`, [userId])
    return rows[0] || null
  }

  async updateRiderAvailability(riderId, isAvailable) {
    const { rows } = await query(
      `UPDATE riders SET is_available = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [riderId, isAvailable]
    )
    return rows[0]
  }

  // ─── SHIFTS ─────────────────────────────────────────
  async findActiveShift(riderId) {
    const { rows } = await query(
      `SELECT * FROM rider_shifts WHERE rider_id = $1 AND status != 'OFF_DUTY' LIMIT 1`,
      [riderId]
    )
    return rows[0] || null
  }

  async startShift(riderId) {
    const { rows } = await query(
      `INSERT INTO rider_shifts (rider_id, status, start_time)
       VALUES ($1, 'ON_DUTY', NOW())
       RETURNING *`,
      [riderId]
    )
    await this.updateRiderAvailability(riderId, true)
    return rows[0]
  }

  async updateShiftStatus(shiftId, status) {
    const isOff = status === 'OFF_DUTY'
    const endTimeClause = isOff ? `, end_time = NOW()` : ''
    const { rows } = await query(
      `UPDATE rider_shifts SET status = $2 ${endTimeClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [shiftId, status]
    )
    if (rows[0]) {
      await this.updateRiderAvailability(rows[0].rider_id, status === 'ON_DUTY')
    }
    return rows[0]
  }

  // ─── ASSIGNMENTS & STATUS ───────────────────────────
  async createAssignment(orderId, riderId, notes = null) {
    const { rows } = await query(
      `INSERT INTO delivery_assignments (order_id, rider_id, status, notes)
       VALUES ($1, $2, 'ASSIGNED', $3)
       RETURNING *`,
      [orderId, riderId, notes]
    )
    return rows[0]
  }

  async findAssignmentById(assignmentId) {
    const { rows } = await query(`SELECT * FROM delivery_assignments WHERE id = $1 LIMIT 1`, [assignmentId])
    return rows[0] || null
  }

  async findActiveAssignmentByOrder(orderId) {
    const { rows } = await query(
      `SELECT * FROM delivery_assignments WHERE order_id = $1 AND status NOT IN ('DELIVERED', 'FAILED', 'CANCELLED') LIMIT 1`,
      [orderId]
    )
    return rows[0] || null
  }

  async updateAssignmentStatus(assignmentId, status, notes = null) {
    const isTerminal = ['DELIVERED', 'FAILED', 'CANCELLED'].includes(status)
    const completedClause = isTerminal ? `, completed_at = NOW()` : ''
    const { rows } = await query(
      `UPDATE delivery_assignments SET status = $2, notes = COALESCE($3, notes) ${completedClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [assignmentId, status, notes]
    )
    return rows[0]
  }

  async logStatusTransition(assignmentId, fromStatus, toStatus, actorId = null, notes = null) {
    const { rows } = await query(
      `INSERT INTO delivery_status_history (delivery_assignment_id, from_status, to_status, actor_id, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [assignmentId, fromStatus, toStatus, actorId, notes]
    )
    return rows[0]
  }

  async logAudit(assignmentId, actorId = null, action = '', payload = {}) {
    const { rows } = await query(
      `INSERT INTO delivery_audit_logs (delivery_assignment_id, actor_id, action, payload)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [assignmentId, actorId, action, JSON.stringify(payload)]
    )
    return rows[0]
  }

  async listRiders(activeOnly = false) {
    const where = activeOnly ? 'WHERE is_active = true' : ''
    const { rows } = await query(`SELECT * FROM riders ${where} ORDER BY created_at DESC`)
    return rows
  }

  async listAssignments(riderId = null, status = null) {
    const conditions = ['1=1']
    const params = []
    let idx = 1

    if (riderId) {
      conditions.push(`rider_id = $${idx}`)
      params.push(riderId)
      idx++
    }

    if (status) {
      conditions.push(`status = $${idx}`)
      params.push(status)
      idx++
    }

    const { rows } = await query(
      `SELECT da.*, o.order_number, r.vehicle_type
         FROM delivery_assignments da
         JOIN orders o ON o.id = da.order_id
         JOIN riders r ON r.id = da.rider_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY da.created_at DESC`,
      params
    )
    return rows
  }
}
