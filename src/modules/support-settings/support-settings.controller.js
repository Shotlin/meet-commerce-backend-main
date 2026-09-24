import { success, error } from '../../utils/apiResponse.js'

export class SupportSettingsController {
  constructor(service) {
    this.service = service
  }

  getPublic = async (request, reply) => {
    const data = await this.service.getPublic()
    return reply.send(success(data, 'Support settings'))
  }

  getAdmin = async (request, reply) => {
    const data = await this.service.getAdmin()
    return reply.send(success(data, 'Support settings'))
  }

  save = async (request, reply) => {
    try {
      const data = await this.service.save(request.body, request.user?.id ?? null)
      return reply.send(success(data, 'Support settings saved'))
    } catch (err) {
      return reply.code(err.statusCode || 500).send(error(err.message, err.code))
    }
  }
}
