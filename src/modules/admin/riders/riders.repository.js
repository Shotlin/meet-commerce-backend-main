import { query, getClient } from '../../../config/database.js'
import { redis } from '../../../config/redis.js'
import { OPEN_ASSIGNMENT_STATUSES, sqlInList } from '../../../constants/delivery-statuses.js'

export class AdminRidersRepository {
  /**
   * @param {string|null} shopId - when given (a shop-staff caller, or HQ
   * with X-Shop-Id set), the roster is filtered to riders holding an
   * ACTIVE `rider_store_assignments` row for this shop — a shop manager
   * only ever sees their own store's riders, never the global fleet.
   * `null` (HQ with no shop selected) keeps the original unscoped
   * behaviour exactly as before this filter existed.
   */
  async findAll({ offset, limit, search, status, sortBy = 'created_at', sortOrder = 'DESC', shopId = null }) {
    const params = []
    const clauses = ["u.role = 'RIDER'"]
    let idx = 1

    if (shopId) {
      clauses.push(
        `EXISTS (SELECT 1 FROM rider_store_assignments rsa WHERE rsa.rider_id = u.id AND rsa.shop_id = $${idx} AND rsa.is_active = true)`
      )
      params.push(shopId)
      idx++
    }
    if (search) {
      clauses.push(`(u.name ILIKE $${idx} OR u.phone ILIKE $${idx})`)
      params.push(`%${search}%`)
      idx++
    }
    if (status === 'online') { clauses.push('rp.is_online = true') }
    else if (status === 'offline') { clauses.push('rp.is_online = false') }
    else if (status === 'pending') { clauses.push('rp.is_approved = false') }
    else if (status === 'suspended') { clauses.push('u.is_active = false') }

    const allowedSort = { created_at: 'u.created_at', name: 'u.name', deliveries: 'rp.total_deliveries', rating: 'rp.rating' }
    const orderCol = allowedSort[sortBy] || 'u.created_at'
    const dir = sortOrder === 'ASC' ? 'ASC' : 'DESC'
    const where = clauses.join(' AND ')

    const { rows } = await query(
      `SELECT u.id, u.name, u.phone, u.avatar_url, u.is_active,
              rp.vehicle_type, rp.vehicle_number, rp.is_approved, rp.is_online,
              rp.rating, rp.total_deliveries, rp.commission_rate,
              rp.current_lat, rp.current_lng, u.created_at,
              EXISTS (
                SELECT 1 FROM delivery_assignments da
                WHERE da.rider_id = u.id
                  AND da.status IN (${sqlInList(OPEN_ASSIGNMENT_STATUSES)})
              ) AS is_busy
       FROM users u
       LEFT JOIN rider_profiles rp ON rp.user_id = u.id
       WHERE ${where}
       ORDER BY ${orderCol} ${dir} NULLS LAST
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    )
    const countRes = await query(
      `SELECT COUNT(*)::int AS total FROM users u LEFT JOIN rider_profiles rp ON rp.user_id = u.id WHERE ${where}`,
      params
    )
    return { riders: rows, total: countRes.rows[0].total }
  }

  async findById(riderId) {
    const { rows: [rider] } = await query(
      `SELECT u.*, rp.vehicle_type, rp.vehicle_number, rp.license_url, rp.aadhar_url,
              rp.is_approved, rp.is_online, rp.rating, rp.total_deliveries,
              rp.commission_rate, rp.bank_account_number, rp.bank_ifsc, rp.bank_name,
              rp.current_lat, rp.current_lng,
              EXISTS (
                SELECT 1 FROM delivery_assignments da
                WHERE da.rider_id = u.id
                  AND da.status IN (${sqlInList(OPEN_ASSIGNMENT_STATUSES)})
              ) AS is_busy
       FROM users u
       LEFT JOIN rider_profiles rp ON rp.user_id = u.id
       WHERE u.id = $1 AND u.role = 'RIDER'`,
      [riderId]
    )
    return rider || null
  }

  async getEarnings(riderId, { startDate, endDate }) {
    const params = [riderId]
    let dateFilter = ''
    if (startDate) {
      params.push(startDate)
      dateFilter += ` AND re.created_at >= $${params.length}`
    }
    if (endDate) {
      params.push(endDate)
      dateFilter += ` AND re.created_at <= $${params.length}`
    }

    const { rows: summary } = await query(
      `SELECT COALESCE(SUM(re.amount), 0) AS total,
              COUNT(*)::int AS delivery_count,
              COALESCE(AVG(re.amount), 0) AS avg_per_delivery
       FROM rider_earnings re
       WHERE re.rider_id = $1 ${dateFilter}`,
      params
    )

    const { rows: daily } = await query(
      `SELECT DATE(re.created_at) AS date, SUM(re.amount) AS total, COUNT(*)::int AS deliveries
       FROM rider_earnings re
       WHERE re.rider_id = $1 ${dateFilter}
       GROUP BY DATE(re.created_at)
       ORDER BY date DESC LIMIT 30`,
      params
    )

    return {
      summary: {
        total: parseFloat(summary[0].total),
        delivery_count: summary[0].delivery_count,
        avg_per_delivery: parseFloat(summary[0].avg_per_delivery),
      },
      daily: daily.map(d => ({ ...d, total: parseFloat(d.total) })),
    }
  }

  async getPayouts(riderId) {
    const { rows } = await query(
      `SELECT * FROM rider_payouts WHERE rider_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [riderId]
    )
    return rows
  }

  async createPayout(riderId, amount, method, reference, adminId) {
    const client = await getClient()
    try {
      await client.query('BEGIN')
      const { rows: [payout] } = await client.query(
        `INSERT INTO rider_payouts (rider_id, amount, payment_ref, status, initiated_by, period_start, period_end)
         VALUES ($1, $2, $3, 'PAID', $4, CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE) RETURNING *`,
        [riderId, amount, reference || method, adminId]
      )
      await client.query('COMMIT')
      return payout
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  async toggleSuspend(riderId, suspended) {
    const client = await getClient()
    try {
      await client.query('BEGIN')
      const { rows: [user] } = await client.query(
        'UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING id, name, is_active',
        [!suspended, riderId]
      )
      if (suspended && user) {
        // Big Phase 17 consistency: a suspended rider must not linger on
        // the live map or in the dispatch pool. Force offline and drop
        // the location cache in the same transaction as the suspension.
        await client.query(
          `UPDATE rider_profiles SET is_online = false, updated_at = NOW()
           WHERE user_id = $1 AND is_online = true`,
          [riderId]
        )
      }
      await client.query('COMMIT')
      if (suspended && user) {
        // Redis lives outside the transaction — clear the cached fix
        // after commit so the live map loses them immediately.
        await redis.del(`rider:location:${riderId}`)
      }
      return user
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  async updateCommission(riderId, rate) {
    const { rows: [profile] } = await query(
      `UPDATE rider_profiles SET commission_rate = $1, updated_at = NOW()
       WHERE user_id = $2 RETURNING user_id, commission_rate`,
      [rate, riderId]
    )
    return profile
  }

  async approveRider(riderId, is_approved) {
    const { rows: [profile] } = await query(
      `UPDATE rider_profiles SET is_approved = $1, updated_at = NOW()
       WHERE user_id = $2 RETURNING user_id, is_approved`,
      [is_approved, riderId]
    )
    return profile
  }

  async getApprovalStatus(riderId) {
    const { rows: [profile] } = await query(
      `SELECT user_id, is_approved,
              COALESCE(approval_status, CASE WHEN is_approved THEN 'APPROVED' ELSE 'PENDING' END) AS approval_status
       FROM rider_profiles
       WHERE user_id = $1`,
      [riderId]
    )
    return profile || null
  }

  async setApprovalStatus(riderId, status) {
    const { rows: [profile] } = await query(
      `UPDATE rider_profiles
       SET approval_status = $1, is_approved = true, updated_at = NOW()
       WHERE user_id = $2
       RETURNING user_id, approval_status, is_approved`,
      [status, riderId]
    )
    return profile || null
  }

  async getDocuments(riderId) {
    const { rows } = await query(
      'SELECT * FROM rider_documents WHERE rider_id = $1 ORDER BY uploaded_at DESC',
      [riderId]
    )
    return rows
  }

  async verifyDocument(documentId, status, note, adminId) {
    const isApproved = status === 'APPROVED'
    const { rows: [doc] } = await query(
      `UPDATE rider_documents
       SET verified = $1, verified_by = $2, verified_at = NOW(),
           rejection_reason = $3
       WHERE id = $4 RETURNING *`,
      [isApproved, adminId, isApproved ? null : (note || null), documentId]
    )
    return doc
  }

  /**
   * @param {string|null} shopId - when given (the Coverage Map's use), only
   * riders with an OPEN delivery assignment for an order belonging to this
   * shop are returned (INNER JOIN via orders.shop_id). With no shopId (the
   * Delivery page's fleet-wide view, unchanged), every online rider comes
   * back regardless of what they're delivering or for whom.
   */
  async getLiveLocations(shopId = null) {
    const assignmentJoin = shopId
      ? `JOIN delivery_assignments da ON da.rider_id = u.id
           AND da.status IN (${sqlInList(OPEN_ASSIGNMENT_STATUSES)})
         JOIN orders o ON o.id = da.order_id AND o.shop_id = $1`
      : `LEFT JOIN delivery_assignments da ON da.rider_id = u.id
           AND da.status IN (${sqlInList(OPEN_ASSIGNMENT_STATUSES)})`
    const params = shopId ? [shopId] : []
    const { rows } = await query(
      `SELECT u.id, u.name, u.phone, rp.current_lat, rp.current_lng,
              rp.vehicle_type, rp.is_online, rp.location_updated_at,
              da.order_id, da.status AS delivery_status
       FROM users u
       JOIN rider_profiles rp ON rp.user_id = u.id
       ${assignmentJoin}
       WHERE rp.is_online = true AND u.is_active = true
       ORDER BY u.name`,
      params
    )
    return rows
  }

  // ─── STORE ASSIGNMENTS + BUSY STATE (Big Phase 6) ───

  async riderExists(riderId) {
    const { rows } = await query(
      `SELECT 1 FROM users WHERE id = $1 AND role = 'RIDER' LIMIT 1`,
      [riderId]
    )
    return rows.length > 0
  }

  /**
   * True iff [riderId] has an ACTIVE assignment to [shopId]. Backs the
   * shop-scoped ownership guard: a shop-staff caller may only act on a
   * rider once this is true — see riders.routes.js's `requireRiderOwnership`.
   */
  async hasActiveAssignment(riderId, shopId) {
    const { rows } = await query(
      `SELECT 1 FROM rider_store_assignments
        WHERE rider_id = $1 AND shop_id = $2 AND is_active = true
        LIMIT 1`,
      [riderId, shopId]
    )
    return rows.length > 0
  }

  /**
   * Finds a rider by phone for the shop-side "add a rider" search. The
   * caller passes an already-normalised (digits-only, `91`-prefix
   * stripped) number; matched against `users.phone` with the same
   * digits-only normalisation on the stored value, checked against
   * both the bare number and a `91`-prefixed variant, since this
   * codebase does not enforce one single storage convention for phone
   * numbers (§ CLAUDE.md). Never a wildcard/partial search — bounded to
   * one exact number, so a shop-scoped caller cannot browse the roster.
   */
  async findByPhone(normalizedPhone) {
    const { rows: [rider] } = await query(
      `SELECT u.id, u.name, u.phone, u.avatar_url, u.is_active,
              rp.vehicle_type, rp.vehicle_number, rp.is_approved, rp.is_online
       FROM users u
       LEFT JOIN rider_profiles rp ON rp.user_id = u.id
       WHERE u.role = 'RIDER'
         AND regexp_replace(u.phone, '\\D', '', 'g') IN ($1, '91' || $1::text)
       LIMIT 1`,
      [normalizedPhone]
    )
    return rider || null
  }

  /**
   * Inserts or reactivates/deactivates exactly ONE (rider, shop) row —
   * never touches any other shop's assignment for this rider. This is
   * the endpoint a shop-scoped caller uses (see `PUT /:id/my-shop-
   * assignment`); the HQ-only `replaceStoreAssignments` below is the
   * only place a caller can ever affect a shop it doesn't own.
   */
  async setSingleAssignment(riderId, shopId, active) {
    const { rows: [row] } = await query(
      `INSERT INTO rider_store_assignments (rider_id, shop_id, is_active)
       VALUES ($1, $2, $3)
       ON CONFLICT (rider_id, shop_id)
       DO UPDATE SET is_active = $3, updated_at = NOW()
       RETURNING id, rider_id, shop_id, is_active, created_at, updated_at`,
      [riderId, shopId, active]
    )
    return row
  }

  async getStoreAssignments(riderId) {
    const { rows } = await query(
      `SELECT rsa.id, rsa.rider_id, rsa.shop_id, rsa.is_active,
              rsa.created_at, rsa.updated_at,
              s.name AS shop_name,
              CONCAT_WS(', ', s.address_line1, s.address_line2, s.city, s.state, s.pincode) AS shop_address
       FROM rider_store_assignments rsa
       JOIN shops s ON s.id = rsa.shop_id
       WHERE rsa.rider_id = $1
       ORDER BY rsa.is_active DESC, s.name`,
      [riderId]
    )
    return rows
  }

  /**
   * Replaces a rider's active store set in one transaction: shops in
   * [shopIds] are activated (rows upserted), every other existing row is
   * soft-deactivated so assignment history is preserved. Idempotent —
   * sending the same set twice leaves the same state.
   */
  async replaceStoreAssignments(riderId, shopIds) {
    const client = await getClient()
    try {
      await client.query('BEGIN')
      const { rows: deactivated } = await client.query(
        `UPDATE rider_store_assignments
         SET is_active = false, updated_at = NOW()
         WHERE rider_id = $1 AND is_active = true
           AND NOT (shop_id = ANY($2::uuid[]))
         RETURNING shop_id`,
        [riderId, shopIds]
      )
      const { rows: activated } = await client.query(
        `INSERT INTO rider_store_assignments (rider_id, shop_id, is_active)
         SELECT $1, shop_id, true
         FROM unnest($2::uuid[]) AS shop_id
         ON CONFLICT (rider_id, shop_id)
         DO UPDATE SET is_active = true, updated_at = NOW()
         RETURNING shop_id, is_active`,
        [riderId, shopIds]
      )
      await client.query('COMMIT')
      return { activated: activated.length, deactivated: deactivated.length }
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  // ─── COD COLLECTIONS + SETTLEMENTS (Big Phase 14) ───

  async getCollectionsForAdmin(riderId) {
    const { rows } = await query(
      `SELECT dc.*, o.order_number
       FROM delivery_collections dc
       JOIN orders o ON o.id = dc.order_id
       WHERE dc.rider_id = $1
       ORDER BY dc.collected_at DESC
       LIMIT 200`,
      [riderId]
    )
    return rows
  }

  async getSettlements(riderId) {
    const { rows } = await query(
      `SELECT * FROM rider_cash_settlements
       WHERE rider_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [riderId]
    )
    return rows
  }

  /**
   * Records a settlement and flips the rider's COLLECTED cash rows to
   * SETTLED in one transaction. Returns the settlement row.
   */
  async createSettlement({ riderId, amount, method, reference, settledBy }) {
    const client = await getClient()
    try {
      await client.query('BEGIN')
      const { rows: [settlement] } = await client.query(
        `INSERT INTO rider_cash_settlements (rider_id, amount, method, reference, status, settled_by)
         VALUES ($1, $2, $3, $4, 'SETTLED', $5)
         RETURNING *`,
        [riderId, amount, method, reference, settledBy]
      )
      await client.query(
        `UPDATE delivery_collections
         SET status = 'SETTLED', updated_at = NOW()
         WHERE rider_id = $1 AND status = 'COLLECTED' AND cash_amount > 0`,
        [riderId]
      )
      await client.query('COMMIT')
      return settlement
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  async setBusinessUpi(riderId, businessUpiId) {
    const { rows } = await query(
      `UPDATE rider_profiles SET business_upi_id = $1, updated_at = NOW()
       WHERE user_id = $2
       RETURNING user_id, business_upi_id`,
      [businessUpiId, riderId]
    )
    return rows[0] || null
  }
}
