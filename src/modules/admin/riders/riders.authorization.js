/**
 * Pure authorization decisions for the admin riders module — extracted
 * from `riders.routes.js` so the actual security logic can be unit-
 * tested directly, without booting a Fastify instance. Mirrors the
 * `assertShopMatch` / `requireShopMatch` split already established in
 * `middlewares/shop-scope.js`: the pure decision lives here, a thin
 * Fastify preHandler wrapper lives in the routes file.
 *
 * Every function takes plain primitives (never a Fastify request/reply)
 * so a test can drive every branch with a one-line call.
 */

/**
 * Decision for `GET /` (the roster list): `riders.view` is always
 * required (checked separately by the caller via `requirePermission`);
 * this only decides whether `reports.global_view` is ALSO required —
 * true only for an unscoped (HQ, no shop selected) request. A shop
 * manager viewing their own shop's roster never needed the HQ-wide
 * reporting permission.
 *
 * @param {string|null} shopId
 * @returns {boolean}
 */
export function listRequiresGlobalView(shopId) {
  return !shopId
}

/**
 * Decision for every `/:id/...` route: may a caller scoped to [shopId]
 * act on a rider that has (or does not have) an active assignment to
 * that shop? `shopId === null` means an HQ caller with no shop
 * selected — always allowed, unchanged from before this module's
 * shop-scoping existed. [riderHasActiveAssignment] is the pre-fetched
 * result of `AdminRidersRepository#hasActiveAssignment`.
 *
 * @param {{ shopId: string|null, riderHasActiveAssignment: boolean }} args
 * @returns {boolean}
 */
export function canActOnRider({ shopId, riderHasActiveAssignment }) {
  if (!shopId) return true
  return riderHasActiveAssignment === true
}

/**
 * Decision for the HQ-only actions (bank payouts, the global commission
 * rate, and the full store-assignment REPLACE) — a shop-scoped caller
 * must never reach these, since they affect the rider account/other
 * shops, not just the caller's own shop.
 *
 * @param {string|null} shopId
 * @returns {boolean} true when the caller is allowed through
 */
export function isHqOnlyActionAllowed(shopId) {
  return !shopId
}

/**
 * Decision for `PUT /:id/my-shop-assignment` — the single-shop toggle
 * needs an actual resolved shop to act on (a shop-staff JWT always has
 * one; an HQ caller must supply X-Shop-Id first).
 *
 * @param {string|null} shopId
 * @returns {boolean}
 */
export function hasResolvedShopForAssignment(shopId) {
  return Boolean(shopId)
}
