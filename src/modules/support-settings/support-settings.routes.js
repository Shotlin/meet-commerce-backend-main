import { SupportSettingsController } from './support-settings.controller.js'
import { SupportSettingsService } from './support-settings.service.js'
import {
  getPublicSettingsSchema,
  getAdminSettingsSchema,
  updateSettingsSchema,
} from './support-settings.schema.js'

const service = new SupportSettingsService()
const controller = new SupportSettingsController(service)

/**
 * Public support-settings route.
 * Prefix: /api/v1/support-settings
 *
 *   GET / — no auth required. The single source of truth every "Need Help"
 *   / "Contact Us" surface in the mobile app reads brand name / support
 *   phone / support email from — see CLAUDE.md §7.4.
 */
export async function publicSupportSettingsRoutes(fastify) {
  fastify.get('/', {
    schema: getPublicSettingsSchema,
  }, controller.getPublic)
}

/**
 * Admin support-settings routes.
 * Prefix: /api/v1/admin/support-settings
 *
 *   GET / — current settings
 *   PUT / — update brand name / support phone / support email
 */
export async function adminSupportSettingsRoutes(fastify) {
  const adminAuth = [fastify.authenticate, fastify.requireAdmin]

  fastify.get('/', {
    schema: getAdminSettingsSchema,
    preHandler: adminAuth,
  }, controller.getAdmin)

  fastify.put('/', {
    schema: updateSettingsSchema,
    preHandler: adminAuth,
  }, controller.save)
}
