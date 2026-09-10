import { success } from '../../utils/apiResponse.js'

/**
 * Ola Maps controller — thin HTTP layer
 */
export class OlaMapsController {
  constructor(service) {
    this.service = service
  }

  /** GET /style-url [AUTH] */
  async getStyleUrl(request, reply) {
    // The public API is HTTPS, but the reverse proxy terminates TLS before
    // handing the request to Fastify. Some proxy paths omit X-Forwarded-Proto,
    // making request.protocol incorrectly become `http` and causing Android
    // MapLibre to reject the returned style URL as clear-text traffic.
    const forwardedProto = request.headers['x-forwarded-proto']
    const protocol = Array.isArray(forwardedProto)
      ? forwardedProto[0]
      : forwardedProto?.split(',')[0]?.trim()
    const publicProtocol = protocol === 'http' || protocol === 'https'
      ? protocol
      : 'https'
    const publicBaseUrl = `${publicProtocol}://${request.hostname}`
    const { configured, styleUrl } = await this.service.getStyleInfo(publicBaseUrl)
    return reply.code(200).send(success({ configured, styleUrl }))
  }

  /**
   * GET /style.json [PUBLIC] — the URL getStyleUrl hands back. No app auth:
   * the native map engine that fetches this can't attach our bearer token,
   * same constraint every client-embedded map key lives with. Returns the
   * raw MapLibre style document, not the {success,data} envelope — this is
   * fetched directly by MapLibreMap's native styleString loader.
   */
  async styleJson(request, reply) {
    const style = await this.service.buildProxiedStyle(request.query.style)
    if (!style) {
      return reply.code(503).send({ error: 'Ola Maps style unavailable' })
    }
    return reply.code(200).send(style)
  }

  /** GET /static-map-url [AUTH] */
  async getStaticMapUrl(request, reply) {
    const { lat, lng, zoom, width, height, marker } = request.query
    const url = await this.service.getStaticMapUrl(lat, lng, { zoom, width, height, marker })
    return reply.code(200).send(success({ configured: url !== null, url }))
  }

  /** GET /geocode */
  async geocode(request, reply) {
    const configured = await this.service.isConfigured()
    const result = configured ? await this.service.geocode(request.query.address) : null
    return reply.code(200).send(success({ configured, result }))
  }

  /** GET /reverse-geocode */
  async reverseGeocode(request, reply) {
    const { lat, lng } = request.query
    const configured = await this.service.isConfigured()
    const result = configured ? await this.service.reverseGeocode(lat, lng) : null
    return reply.code(200).send(success({ configured, result }))
  }

  /** GET /directions */
  async directions(request, reply) {
    const { originLat, originLng, destLat, destLng } = request.query
    const configured = await this.service.isConfigured()
    const result = configured
      ? await this.service.directions(originLat, originLng, destLat, destLng)
      : null
    return reply.code(200).send(success({ configured, result }))
  }
}
