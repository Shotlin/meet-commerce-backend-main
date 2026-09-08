/**
 * Orders Service — 17-State Machine Engine & Fulfilment Workflow
 * Source of truth: Blueprint §06.7, Phase 8
 *
 * @module modules/orders/orders.service
 */

import crypto from 'node:crypto'
import { logger } from '../../config/logger.js'
import { getClient } from '../../config/database.js'
import { CartRepository } from '../cart/cart.repository.js'
import { CartService } from '../cart/cart.service.js'
import { AddressesRepository } from '../addresses/addresses.repository.js'
import { ShopProductsRepository } from '../shop-products/shop-products.repository.js'

const ALLOWED_TRANSITIONS = {
  CART_CREATED: ['ORDER_PLACED', 'CANCELLED'],
  ORDER_PLACED: ['PAYMENT_PENDING', 'CANCELLED', 'PAYMENT_FAILED'],
  PAYMENT_PENDING: ['PAYMENT_CONFIRMED', 'PAYMENT_FAILED', 'CANCELLED'],
  PAYMENT_CONFIRMED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['ALLOCATING_STOCK', 'CANCELLED'],
  ALLOCATING_STOCK: ['STOCK_RESERVED', 'CANCELLED'],
  STOCK_RESERVED: ['PICKING', 'CANCELLED'],
  PICKING: ['PACKING', 'CANCELLED'],
  PACKING: ['READY_FOR_DISPATCH', 'CANCELLED'],
  READY_FOR_DISPATCH: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: ['OUT_FOR_DELIVERY', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'CANCELLED'],
  DELIVERED: ['COMPLETED', 'RETURN_REQUESTED'],
  COMPLETED: [],
  CANCELLED: [],
  PAYMENT_FAILED: ['PAYMENT_PENDING', 'CANCELLED'],
  RETURN_REQUESTED: ['RETURNED', 'COMPLETED'],
  RETURNED: [],
}

export class OrdersService {
  /**
   * @param {import('./orders.repository.js').OrdersRepository} repository
   * @param {import('../cart-quote/cart-quote.repository.js').CartQuoteRepository} quoteRepository
   */
  constructor(repository, quoteRepository, deps = {}) {
    this.repository = repository
    this.quoteRepository = quoteRepository
    this.storeStatusService = deps?.storeStatusService || null
    this.deliveryCalendarService = deps?.deliveryCalendarService || null
    this.paymentSettingsService = deps?.paymentSettingsService || deps?.configService || null
    this.billSummaryService = deps?.billSummaryService || null
    this.cartRepo = deps?.cartRepository || new CartRepository()
    this.cartService = deps?.cartService || new CartService(this.cartRepo)
    this.addressRepo = deps?.addressesRepository || new AddressesRepository()
    this.shopProductsRepo = deps?.shopProductsRepository || new ShopProductsRepository()
  }

  /**
   * Checkout endpoint used by the mobile app.  This intentionally bridges
   * the current Redis, store-aware cart to the Phase-8 orders tables; the
   * previous handler only accepted a legacy checkout quote and therefore
   * rejected every real mobile order before any checkout logic ran.
   */
  async placeOrder(customerId, payload) {
    const priceMode = payload.priceMode === 'wholesale' ? 'wholesale' : 'retail'
    const validation = await this.cartService.validateCart(customerId, priceMode)
    if (!validation.valid) {
      const err = new Error(validation.warnings?.[0] || 'Your cart cannot be checked out')
      err.statusCode = 400
      err.code = validation.failed?.[0]?.code || 'CART_INVALID'
      throw err
    }

    const address = await this.addressRepo.findByIdAndUser(payload.addressId, customerId)
    if (!address) {
      const err = new Error('Delivery address not found')
      err.statusCode = 404
      err.code = 'ADDRESS_NOT_FOUND'
      throw err
    }

    const groups = [...validation.groupedByShop.entries()]
    const client = await getClient()
    const created = []
    try {
      await client.query('BEGIN')
      for (const [shopId, cartItems] of groups) {
        const items = cartItems.map((line) => ({
            productId: line.productId,
            shopProductId: line.shopProductId,
            name: line.name,
            price: Number(line.effectivePrice),
            quantity: Number(line.quantity),
            unit: line.unit || null,
            total: Number(line.lineTotal),
            thumbnailUrl: line.thumbnailUrl || null,
            pricingMode: priceMode,
          }))

        const subtotal = Number(items.reduce((sum, item) => sum + item.total, 0).toFixed(2))
        const deliveryFee = subtotal >= 499 ? 0 : 25
        const platformFee = 5
        const totalPayable = Number((subtotal + deliveryFee + platformFee).toFixed(2))
        const orderNumber = await this.repository.generateCheckoutOrderNumber(client, shopId)
        const row = await this.repository.createCheckoutOrder(client, {
          orderNumber,
          customerId,
          shopId,
          status: 'ORDER_PLACED',
          items,
          subtotal,
          deliveryFee,
          platformFee,
          totalPayable,
          paymentMethod: payload.paymentMethod,
          paymentStatus: payload.paymentMethod === 'COD' ? 'PENDING' : 'PENDING',
          couponCode: payload.couponCode,
          deliveryAddress: address,
          deliveryNotes: payload.deliveryNotes,
          estimatedDelivery: payload.deliveryMode === 'SCHEDULED'
            ? payload.scheduledDeliveryAt || null
            : null,
        })
        for (const item of items) {
          await this.shopProductsRepo.applyStockChange(client, {
            shopProductId: item.shopProductId,
            delta: -item.quantity,
            type: 'ORDER_DEDUCTION',
            source: 'ORDER',
            orderId: row.id,
            reason: `Order ${orderNumber}`,
          })
        }
        await this.repository.logStatusTransition(
          row.id, null, 'ORDER_PLACED', customerId, 'Order placed from mobile checkout'
        )
        created.push(this.repository._formatCheckoutOrder(row))
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    // COD is confirmed as an order immediately.  Online carts remain until
    // Razorpay verification succeeds, so a cancelled payment is retryable.
    if (payload.paymentMethod === 'COD') {
      await this.cartRepo.clearCart(customerId, priceMode)
      await this.cartRepo.clearExtras(customerId, priceMode)
    }
    logger.info({ customerId, orderIds: created.map((order) => order.id) }, 'Mobile checkout completed')
    return { order: created[0], orders: created }
  }

  async _checkStoreOpenForAsap() {
    if (!this.storeStatusService) return null
    const res = await this.storeStatusService.isOpen()
    if (res && res.isOpen === false) {
      return { success: false, code: 'STORE_CLOSED_ASAP_UNAVAILABLE', message: 'Store is closed for ASAP orders' }
    }
    return null
  }

  async _resolveMaxScheduledAhead(now = new Date()) {
    if (this.deliveryCalendarService) {
      const maxDate = await this.deliveryCalendarService.getMaxGeneratedDate()
      if (maxDate) return new Date(maxDate)
    }
    const ref = new Date(now)
    return new Date(ref.getTime() + 7 * 24 * 60 * 60 * 1000)
  }

  async _checkPaymentMethodAllowed(userId, addressId, paymentMethod) {
    if (!this.paymentSettingsService) return null
    const config = this.paymentSettingsService.getConfig
      ? await this.paymentSettingsService.getConfig()
      : (this.paymentSettingsService.get ? await this.paymentSettingsService.get() : {})

    if (paymentMethod === 'COD') {
      if (config.codEnabled === false) {
        return { success: false, code: 'COD_DISABLED', message: 'COD is disabled' }
      }
      if (this.billSummaryService) {
        const summary = await this.billSummaryService.getBillSummary(userId, addressId)
        const totalPayable = summary?.totalPayable ?? summary?.total_payable
        const minAmount = config.codMinOrderAmount ?? config.minCodBill
        const maxAmount = config.codMaxOrderAmount ?? config.maxCodBill
        if (minAmount !== undefined && totalPayable < minAmount) {
          return { success: false, code: 'COD_BELOW_MIN', message: `Bill total is below minimum ${minAmount} for COD` }
        }
        if (maxAmount !== undefined && totalPayable > maxAmount) {
          return { success: false, code: 'COD_ABOVE_MAX', message: `Bill total exceeds maximum ${maxAmount} for COD` }
        }
      }
    } else if (paymentMethod === 'ONLINE' || paymentMethod === 'RAZORPAY') {
      if (config.razorpayEnabled === false) {
        return { success: false, code: 'RAZORPAY_DISABLED', message: 'Online payments disabled' }
      }
    } else if (paymentMethod === 'WALLET') {
      if (config.walletEnabled === false) {
        return { success: false, code: 'WALLET_DISABLED', message: 'Wallet payments disabled' }
      }
    }
    return null
  }

  validateStateTransition(currentStatus, nextStatus) {
    const allowed = ALLOWED_TRANSITIONS[currentStatus] || []
    if (!allowed.includes(nextStatus)) {
      const err = new Error(`Invalid order transition from ${currentStatus} to ${nextStatus}`)
      err.statusCode = 400
      err.code = 'INVALID_ORDER_TRANSITION'
      throw err
    }
  }

  async createOrderFromQuote(customerId, payload) {
    const { quote_number, warehouse_id = null } = payload
    const quote = await this.quoteRepository.findQuoteByNumber(quote_number)

    if (!quote) {
      const err = new Error('Checkout quote not found')
      err.statusCode = 404
      err.code = 'QUOTE_NOT_FOUND'
      throw err
    }

    if (quote.customer_id !== customerId) {
      const err = new Error('Forbidden — quote does not belong to your account')
      err.statusCode = 403
      err.code = 'CROSS_CUSTOMER_ACCESS_DENIED'
      throw err
    }

    if (new Date(quote.expires_at) <= new Date()) {
      const err = new Error('Checkout quote has expired. Please generate a new quote.')
      err.statusCode = 400
      err.code = 'QUOTE_EXPIRED'
      throw err
    }

    const orderNumber = `ORD-${String(Date.now()).slice(-8)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`
    const order = await this.repository.createOrder({
      order_number: orderNumber,
      quote_id: quote.id,
      customer_id: customerId,
      warehouse_id,
      status: 'ORDER_PLACED',
      subtotal: quote.subtotal,
      discount_amount: quote.discount_amount,
      loyalty_redeemed_amount: quote.loyalty_redeemed_amount,
      tax_amount: quote.tax_amount,
      total_payable: quote.total_payable,
    })

    // Copy items preserving snapshot
    const cartSnapshot = typeof quote.cart_snapshot === 'string' ? JSON.parse(quote.cart_snapshot) : quote.cart_snapshot
    const items = []
    for (const itemData of cartSnapshot.items || []) {
      const item = await this.repository.addOrderItem(order.id, {
        product_id: itemData.product_id,
        product_name: itemData.name,
        quantity: itemData.quantity,
        unit_price: itemData.unit_price,
        subtotal: itemData.subtotal,
        product_snapshot: itemData,
      })
      items.push(item)
    }

    await this.repository.logStatusTransition(order.id, null, 'ORDER_PLACED', customerId, 'Order created from checkout quote')
    await this.repository.logAudit(order.id, customerId, 'CREATE_ORDER', { quote_number, orderNumber })

    logger.info({ orderId: order.id, orderNumber, customerId }, 'Order created from quote')
    return { ...order, items }
  }

  async transitionOrderStatus(orderId, actorId, nextStatus, notes = null) {
    const order = await this.repository.findOrderById(orderId)
    if (!order) {
      const err = new Error('Order not found')
      err.statusCode = 404
      err.code = 'ORDER_NOT_FOUND'
      throw err
    }

    if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
      const err = new Error(`Order is ${order.status} and cannot be modified`)
      err.statusCode = 400
      err.code = 'ORDER_IMMUTABLE_LOCKED'
      throw err
    }

    this.validateStateTransition(order.status, nextStatus)

    const updatedOrder = await this.repository.updateOrderStatus(orderId, nextStatus)
    await this.repository.logStatusTransition(orderId, order.status, nextStatus, actorId, notes)
    await this.repository.logAudit(orderId, actorId, 'TRANSITION_STATUS', { from: order.status, to: nextStatus, notes })

    // Auto-create fulfilment tasks when entering PICKING or PACKING
    if (nextStatus === 'PICKING') {
      await this.repository.createFulfilmentTask(orderId, 'PICKING', null, 'Auto-created picking task')
    } else if (nextStatus === 'PACKING') {
      await this.repository.createFulfilmentTask(orderId, 'PACKING', null, 'Auto-created packing task')
    }

    logger.info({ orderId, fromStatus: order.status, nextStatus }, 'Order status transitioned')
    return updatedOrder
  }

  async createFulfilmentTask(orderId, actorId, payload) {
    const order = await this.repository.findOrderById(orderId)
    if (!order) {
      const err = new Error('Order not found')
      err.statusCode = 404
      err.code = 'ORDER_NOT_FOUND'
      throw err
    }

    const task = await this.repository.createFulfilmentTask(
      orderId,
      payload.task_type,
      payload.assigned_to || null,
      payload.notes || null
    )

    await this.repository.logAudit(orderId, actorId, 'CREATE_FULFILMENT_TASK', { taskId: task.id, task_type: payload.task_type })
    return task
  }

  async updateFulfilmentTaskStatus(taskId, actorId, status, notes = null) {
    const task = await this.repository.updateFulfilmentTaskStatus(taskId, status, notes)
    if (!task) {
      const err = new Error('Fulfilment task not found')
      err.statusCode = 404
      err.code = 'TASK_NOT_FOUND'
      throw err
    }

    await this.repository.logAudit(task.order_id, actorId, 'UPDATE_FULFILMENT_TASK', { taskId, status, notes })
    return task
  }

  async getOrderById(orderId) {
    const order = await this.repository.findOrderById(orderId)
    if (!order) {
      const err = new Error('Order not found')
      err.statusCode = 404
      err.code = 'ORDER_NOT_FOUND'
      throw err
    }
    return order
  }

  async listOrders(params = {}) {
    return this.repository.listOrders(params.customerId, params.warehouseId, params.status)
  }

  async getInvoice(userId, orderId) {
    const order = this.repository.findById
      ? await this.repository.findById(orderId)
      : await this.repository.findOrderById(orderId)

    if (!order) {
      return { success: false, statusCode: 404, message: 'Order not found' }
    }

    const ownerId = order.userId || order.customer_id || order.user_id
    if (ownerId !== userId) {
      return { success: false, statusCode: 403, message: 'Access denied' }
    }

    const paymentStatus = order.paymentStatus || order.payment_status
    if (paymentStatus !== 'PAID') {
      return { success: false, statusCode: 400, message: 'Invoice available only for paid orders' }
    }

    const timeline = this.repository.getStatusHistory
      ? await this.repository.getStatusHistory(orderId)
      : (order.status_history || [])

    const { generateInvoicePDF } = await import('../../utils/invoiceGenerator.js')
    const buffer = await generateInvoicePDF(order, timeline)

    return {
      success: true,
      orderNumber: order.orderNumber || order.order_number,
      buffer,
    }
  }
}
