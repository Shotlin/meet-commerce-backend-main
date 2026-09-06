/**
 * Orders Controller — HTTP Handler Layer for Orders & Fulfilment
 * Source of truth: Blueprint §06.7, Phase 8
 *
 * @module modules/orders/orders.controller
 */

export class OrdersController {
  /**
   * @param {import('./orders.service.js').OrdersService} service
   */
  constructor(service) {
    this.service = service
  }

  createOrderFromQuote = async (req, reply) => {
    const customerId = req.userId || req.user.id
    const order = await this.service.createOrderFromQuote(customerId, req.body)
    return reply.status(201).send({ success: true, data: order })
  }

  transitionOrderStatus = async (req, reply) => {
    const { orderId } = req.params
    const actorId = req.userId || req.user.id
    const updated = await this.service.transitionOrderStatus(orderId, actorId, req.body.status, req.body.notes)
    return reply.status(200).send({ success: true, data: updated })
  }

  createFulfilmentTask = async (req, reply) => {
    const { orderId } = req.params
    const actorId = req.userId || req.user.id
    const task = await this.service.createFulfilmentTask(orderId, actorId, req.body)
    return reply.status(201).send({ success: true, data: task })
  }

  updateFulfilmentTaskStatus = async (req, reply) => {
    const { taskId } = req.params
    const actorId = req.userId || req.user.id
    const task = await this.service.updateFulfilmentTaskStatus(taskId, actorId, req.body.status, req.body.notes)
    return reply.status(200).send({ success: true, data: task })
  }

  getOrderById = async (req, reply) => {
    const { orderId } = req.params
    const order = await this.service.getOrderById(orderId)
    return reply.status(200).send({ success: true, data: order })
  }

  listOrders = async (req, reply) => {
    const params = {
      customerId: req.user?.platform_role === 'CUSTOMER' ? (req.userId || req.user.id) : (req.query.customer_id || null),
      warehouseId: req.warehouseId || req.query.warehouse_id || null,
      status: req.query.status || null,
    }
    const orders = await this.service.listOrders(params)
    return reply.status(200).send({ success: true, data: orders })
  }
}
