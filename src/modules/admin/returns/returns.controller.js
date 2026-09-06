import { success, error } from '../../../utils/apiResponse.js'
import { ReturnsService } from './returns.service.js'

export class ReturnsController {
  constructor(service = new ReturnsService()) {
    this.service = service
  }

  /** GET / */
  async list(request, reply) {
    const { rows, pagination } = await this.service.list(request.query)
    return reply.code(200).send(success(rows, 'Return requests fetched', { pagination }))
  }

  /** GET /:id */
  async getDetail(request, reply) {
    const request_ = await this.service.getDetail(request.params.id)
    if (!request_) return reply.code(404).send(error('Return request not found', 'NOT_FOUND'))
    return reply.code(200).send(success(request_, 'Return request fetched'))
  }

  /** POST / */
  async create(request, reply) {
    const result = await this.service.create(request.body, request.user.id, request.ip)
    if (!result.success) return reply.code(400).send(error(result.message, 'VALIDATION_ERROR'))
    reply.code(201)
    return success(result.request, 'Return request created')
  }

  /** POST /:id/approve */
  async approve(request, reply) {
    const result = await this.service.approve(request.params.id, request.user.id, request.ip, request.body?.adminNotes)
    if (!result.success) return reply.code(400).send(error(result.message, 'APPROVE_FAILED'))
    return reply.code(200).send(success(result.request, 'Return request approved and refunded'))
  }

  /** POST /:id/reject */
  async reject(request, reply) {
    const result = await this.service.reject(request.params.id, request.user.id, request.ip, request.body?.adminNotes)
    if (!result.success) return reply.code(400).send(error(result.message, 'REJECT_FAILED'))
    return reply.code(200).send(success(result.request, 'Return request rejected'))
  }

  /** POST /:id/cancel */
  async cancel(request, reply) {
    const result = await this.service.cancel(request.params.id, request.user.id, request.ip, request.body?.adminNotes)
    if (!result.success) return reply.code(400).send(error(result.message, 'CANCEL_FAILED'))
    return reply.code(200).send(success(result.request, 'Return request cancelled'))
  }
}
