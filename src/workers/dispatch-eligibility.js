import { logger } from '../config/logger.js'

// A rider is dispatch-eligible only while their last known GPS fix is
// fresh enough (blueprint §5: "location fix is fresh enough for
// dispatch"). The Redis cache `rider:location:<id>` carries `updatedAt`
// and expires on its own (TTL); the DB column
// `rider_profiles.location_updated_at` is the durable fallback.
export const RIDER_LOCATION_STALE_MINUTES =
  Number(process.env.RIDER_LOCATION_STALE_MINUTES) || 10

/**
 * Pure freshness decision for one dispatch candidate.
 *
 * @param {object} input
 * @param {number|null} input.redisUpdatedAt  epoch ms from the Redis
 *   location cache, or null when the cache has no entry for the rider.
 * @param {Date|string|null} input.dbLocationUpdatedAt  value of
 *   `rider_profiles.location_updated_at`, or null when the rider never
 *   reported a fix through the DB path.
 * @param {number} [input.nowMs]  current epoch ms (injectable for tests).
 * @param {number} [input.staleMinutes]  max accepted fix age in minutes.
 * @returns {{ fresh: boolean, source: 'redis'|'db'|null, ageSeconds: number|null }}
 */
export function evaluateLocationFreshness({
  redisUpdatedAt,
  dbLocationUpdatedAt,
  nowMs = Date.now(),
  staleMinutes = RIDER_LOCATION_STALE_MINUTES,
}) {
  const maxAgeMs = staleMinutes * 60 * 1000

  if (Number.isFinite(redisUpdatedAt) && redisUpdatedAt > 0) {
    const ageMs = nowMs - redisUpdatedAt
    if (ageMs >= 0 && ageMs <= maxAgeMs) {
      return { fresh: true, source: 'redis', ageSeconds: Math.round(ageMs / 1000) }
    }
    return { fresh: false, source: 'redis', ageSeconds: ageMs >= 0 ? Math.round(ageMs / 1000) : null }
  }

  const dbTime = dbLocationUpdatedAt ? new Date(dbLocationUpdatedAt).getTime() : Number.NaN
  if (Number.isFinite(dbTime) && dbTime > 0) {
    const ageMs = nowMs - dbTime
    if (ageMs >= 0 && ageMs <= maxAgeMs) {
      return { fresh: true, source: 'db', ageSeconds: Math.round(ageMs / 1000) }
    }
    return { fresh: false, source: 'db', ageSeconds: ageMs >= 0 ? Math.round(ageMs / 1000) : null }
  }

  return { fresh: false, source: null, ageSeconds: null }
}

/**
 * Logs (once per skipped batch, not per rider) why candidates were
 * dropped for stale/missing location, so dispatch gaps stay debuggable.
 */
export function logStaleLocationSkips({ skipped, total, orderId, source }) {
  if (!skipped) return
  logger.info(
    { skipped, total, orderId, source, staleMinutes: RIDER_LOCATION_STALE_MINUTES },
    'Auto-assign: candidates skipped for stale or missing location'
  )
}
