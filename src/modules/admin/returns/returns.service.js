import { logAdminActivity } from '../../../utils/activityLogger.js'
import { ReturnsRepository } from './returns.repository.js'
import { PaymentsService } from '../../payments/payments.service.js'
import { PaymentsRepository } from '../../payments/payments.repository.js'
import { WalletService } from '../../wallet/wallet.service.js'
import { WalletRepository } from '../../wallet/wallet.repository.js'

// Orders in these statuses may be returned. Anything earlier in the
// lifecycle (not yet delivered) or already terminal (cancelled/refunded)
// is not a valid return target.
const RETURN_ELIGIBLE_ORDER_STATUSES = ['DELIVERED']

export class ReturnsService {
  constructor(repository = new ReturnsRepository()) {
    this.repo = repository
    this.paymentsService = new PaymentsService(new PaymentsRepository())
    this.paymentsRepo = new PaymentsRepository()
    this.walletService = new WalletService(new WalletRepository())
  }

  async list(filters) {
    const { rows, total } = await this.repo.findAll(filters)
    const page = filters.page || 1
    const limit = filters.limit || 20
    return { rows, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } }
  }

  async getDetail(id) {
    return this.repo.findById(id)
  }

  /**
   * File a return request. The refund amount is always computed here, from
   * the real order — a caller can never supply an amount directly.
   */
  async create(data, adminId, ip) {
    const order = await this.repo.findOrderForReturn(data.orderId)
    if (!order) {
      return { success: false, message: 'Order not found' }
    }
    if (!RETURN_ELIGIBLE_ORDER_STATUSES.includes(order.status)) {
      return { success: false, message: `Order status "${order.status}" is not eligible for a return — only DELIVERED orders can be returned.` }
    }

    const items = order.items || []
    let computedAmount
    let returnItems = null

    if (data.scope === 'FULL_ORDER') {
      computedAmount = Number(order.total_payable)
    } else {
      const indexes = data.itemIndexes || []
      if (indexes.length === 0) {
        return { success: false, message: 'At least one item must be selected for an ITEMS-scope return' }
      }
      returnItems = []
      computedAmount = 0
      for (const idx of indexes) {
        const item = items[idx]
        if (!item) {
          return { success: false, message: `No item at index ${idx} on this order` }
        }
        const lineTotal = Number(item.total ?? item.price * item.quantity)
        returnItems.push({
          itemIndex: idx,
          name: item.name,
          quantity: item.quantity,
          unitPrice: Number(item.price),
          lineTotal,
        })
        computedAmount += lineTotal
      }
    }

    const created = await this.repo.create({
      orderId: order.id,
      customerId: order.customer_id,
      scope: data.scope,
      items: returnItems,
      reason: data.reason,
      refundDestination: data.refundDestination,
      computedAmount: computedAmount.toFixed(2),
      adminNotes: data.adminNotes,
      requestedBy: adminId,
    })

    logAdminActivity(adminId, 'CREATE_RETURN_REQUEST', 'refund_request', created.id, null, created, ip)
    return { success: true, request: await this.repo.findById(created.id) }
  }

  async approve(id, adminId, ip, adminNotes) {
    const request = await this.repo.findById(id)
    if (!request) return { success: false, message: 'Return request not found' }
    if (request.status !== 'PENDING') {
      return { success: false, message: `Only PENDING requests can be approved (this one is ${request.status})` }
    }

    const amount = Number(request.computed_amount)

    if (request.refund_destination === 'RAZORPAY') {
      const payment = await this.paymentsRepo.findByOrderId(request.order_id)
      if (!payment) {
        return { success: false, message: 'No payment record found for this order — cannot issue a Razorpay refund' }
      }
      const refundResult = await this.paymentsService.refund(payment.id, {
        amount,
        reason: `Return request ${request.id}: ${request.reason}`,
      })
      if (!refundResult.success) {
        return { success: false, message: refundResult.message || 'Razorpay refund failed' }
      }
    } else {
      const creditResult = await this.walletService.addMoney(request.customer_id, {
        amount,
        description: `Refund for order return — ${request.reason}`,
        referenceId: request.id,
        orderId: request.order_id,
      })
      if (!creditResult.success) {
        return { success: false, message: creditResult.message || 'Wallet credit failed' }
      }
    }

    const resolved = await this.repo.resolve(id, {
      status: 'APPROVED',
      resolvedAmount: amount,
      resolvedBy: adminId,
      adminNotes,
    })

    logAdminActivity(adminId, 'APPROVE_RETURN_REQUEST', 'refund_request', id, request, resolved, ip)
    return { success: true, request: await this.repo.findById(id) }
  }

  async reject(id, adminId, ip, adminNotes) {
    const request = await this.repo.findById(id)
    if (!request) return { success: false, message: 'Return request not found' }
    if (request.status !== 'PENDING') {
      return { success: false, message: `Only PENDING requests can be rejected (this one is ${request.status})` }
    }

    const resolved = await this.repo.resolve(id, {
      status: 'REJECTED',
      resolvedAmount: null,
      resolvedBy: adminId,
      adminNotes,
    })

    logAdminActivity(adminId, 'REJECT_RETURN_REQUEST', 'refund_request', id, request, resolved, ip)
    return { success: true, request: await this.repo.findById(id) }
  }

  async cancel(id, adminId, ip, adminNotes) {
    const request = await this.repo.findById(id)
    if (!request) return { success: false, message: 'Return request not found' }
    if (request.status !== 'PENDING') {
      return { success: false, message: `Only PENDING requests can be cancelled (this one is ${request.status})` }
    }

    const resolved = await this.repo.resolve(id, {
      status: 'CANCELLED',
      resolvedAmount: null,
      resolvedBy: adminId,
      adminNotes,
    })

    logAdminActivity(adminId, 'CANCEL_RETURN_REQUEST', 'refund_request', id, request, resolved, ip)
    return { success: true, request: await this.repo.findById(id) }
  }
}
