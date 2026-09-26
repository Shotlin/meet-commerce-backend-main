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
import { CouponsRepository } from '../coupons/coupons.repository.js'
import { CouponsService } from '../coupons/coupons.service.js'
import { WalletRepository } from '../wallet/wallet.repository.js'
import { InventoryRepository } from '../inventory/inventory.repository.js'
import { InventoryService } from '../inventory/inventory.service.js'
import { VendorProcurementRepository } from '../vendor-procurement/vendor-procurement.repository.js'

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
    this.couponsRepo = deps?.couponsRepository || new CouponsRepository()
    this.couponsService = deps?.couponsService || new CouponsService(this.couponsRepo)
    this.walletRepo = deps?.walletRepository || new WalletRepository()
    this.inventoryService = deps?.inventoryService || new InventoryService(new InventoryRepository())
    this.vendorProcurementRepo = deps?.vendorProcurementRepository || new VendorProcurementRepository()
  }

  /**
   * Checkout endpoint used by the mobile app.  This intentionally bridges
   * the current Redis, store-aware cart to the Phase-8 orders tables; the
   * previous handler only accepted a legacy checkout quote and therefore
   * rejected every real mobile order before any checkout logic ran.
   */
  async placeOrder(customerId, payload) {
    const priceMode = payload.priceMode === 'wholesale' ? 'wholesale' : 'retail'

    // Idempotency: a retried request for the same checkout attempt (a
    // double-tap that slipped past the client's own isPlacingOrder guard,
    // or a network retry of a response that never arrived) returns the
    // order(s) already created instead of placing a duplicate order or
    // debiting the wallet twice.
    if (payload.clientOrderRef) {
      const existing = await this.repository.findByClientOrderRef(customerId, payload.clientOrderRef)
      if (existing.length > 0) {
        logger.info({ customerId, clientOrderRef: payload.clientOrderRef }, 'placeOrder: idempotent replay, returning existing order(s)')
        return { order: existing[0], orders: existing }
      }
    }

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

    const methodCheck = await this._checkPaymentMethodAllowed(customerId, payload.addressId, payload.paymentMethod)
    if (methodCheck) {
      const err = new Error(methodCheck.message)
      err.statusCode = 400
      err.code = methodCheck.code
      throw err
    }

    const groups = [...validation.groupedByShop.entries()]

    // ── Coupon — validated once against the whole cart via the exact same
    // CouponsService.validate() the mobile app's own "Apply Coupon" sheet
    // already calls (same function, same inputs), so the discount charged
    // here can never disagree with what was already shown/applied.
    // Previously `couponCode` was only ever stored on the order — never
    // actually validated or subtracted from the total.
    let couponResult = null
    const allCartItems = groups.flatMap(([, items]) => items)
    const combinedSubtotal = Number(
      allCartItems.reduce((sum, item) => sum + Number(item.lineTotal), 0).toFixed(2)
    )
    if (payload.couponCode) {
      couponResult = await this.couponsService.validate(
        customerId, payload.couponCode, combinedSubtotal, allCartItems
      )
      if (!couponResult.valid) {
        const err = new Error(couponResult.message || 'This coupon could not be applied.')
        err.statusCode = 400
        err.code = couponResult.code || 'COUPON_INVALID'
        throw err
      }
    }
    const couponDiscount = couponResult?.discount || 0
    const couponFreeDelivery = couponResult?.freeDelivery || false

    // ── Wallet — read the real balance once. The actual debit below
    // re-checks it atomically inside the transaction via the same
    // `WHERE balance >= $1` guard WalletRepository.debit() always uses, so
    // a balance that changes between this read and the debit can only ever
    // make the debit fail safely, never overdraw.
    let walletBalance = 0
    if (payload.useWallet) {
      const wallet = await this.walletRepo.getOrCreate(customerId)
      walletBalance = Number(wallet?.balance || 0)
    }

    // Per-shop-group pricing. Delivery/platform fee stay the existing flat
    // estimate (a separate, already-documented gap from TotalsEngine —
    // out of scope here); coupon discount and the wallet slice are new.
    const groupCharges = groups.map(([shopId, cartItems]) => {
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
        brand: line.brand || null,
        // Captured at checkout time, not re-derived later — a "was ₹X /
        // Y% off" shown on a past order must reflect the discount that was
        // actually true when the customer bought it, not today's price
        // (which may have since changed). `originalPrice` is only ever set
        // when the item genuinely had one (a real sale_price < list price
        // at the moment of purchase) — never invented.
        originalPrice: line.originalPrice != null ? Number(line.originalPrice) : null,
        discountPercent: line.discountPercent ? Number(line.discountPercent) : 0,
      }))
      const subtotal = Number(items.reduce((sum, item) => sum + item.total, 0).toFixed(2))
      const deliveryFee = couponFreeDelivery ? 0 : (subtotal >= 499 ? 0 : 25)
      const platformFee = 5
      return { shopId, items, subtotal, deliveryFee, platformFee }
    })

    const discountShares = this._splitProportional(couponDiscount, groupCharges.map((g) => g.subtotal))
    groupCharges.forEach((g, i) => {
      g.discount = discountShares[i]
      g.payableBeforeWallet = Number((g.subtotal - g.discount + g.deliveryFee + g.platformFee).toFixed(2))
    })

    const combinedPayableBeforeWallet = Number(
      groupCharges.reduce((sum, g) => sum + g.payableBeforeWallet, 0).toFixed(2)
    )
    // walletApplied = min(availableWalletBalance, currentPayableAmount) —
    // never more than the customer actually has, never more than the bill.
    const walletApplied = payload.useWallet ? Math.min(walletBalance, combinedPayableBeforeWallet) : 0
    const walletShares = this._splitProportional(walletApplied, groupCharges.map((g) => g.payableBeforeWallet))
    groupCharges.forEach((g, i) => {
      g.walletAmount = walletShares[i]
      g.totalPayable = Number((g.payableBeforeWallet - g.walletAmount).toFixed(2))
    })

    const client = await getClient()
    const created = []
    try {
      await client.query('BEGIN')
      for (const group of groupCharges) {
        // Wallet fully covering the bill is the same "nothing left to
        // collect" outcome whether the customer picked COD or ONLINE — no
        // Razorpay order gets created for it either way (the mobile app's
        // own `alreadyPaid` check already handles this: see
        // checkout_provider.dart#placeOrder).
        const walletCoversInFull = group.totalPayable <= 0 && group.walletAmount > 0
        const debitNow = payload.paymentMethod === 'COD' || walletCoversInFull

        const orderNumber = await this.repository.generateCheckoutOrderNumber(client, group.shopId)
        const row = await this.repository.createCheckoutOrder(client, {
          orderNumber,
          customerId,
          shopId: group.shopId,
          status: 'ORDER_PLACED',
          items: group.items,
          subtotal: group.subtotal,
          discountAmount: group.discount,
          deliveryFee: group.deliveryFee,
          platformFee: group.platformFee,
          totalPayable: group.totalPayable,
          paymentMethod: payload.paymentMethod,
          paymentStatus: walletCoversInFull ? 'PAID' : 'PENDING',
          couponCode: payload.couponCode,
          deliveryAddress: address,
          deliveryNotes: payload.deliveryNotes,
          estimatedDelivery: payload.deliveryMode === 'SCHEDULED'
            ? payload.scheduledDeliveryAt || null
            : null,
          walletAmount: group.walletAmount,
          // COD debits immediately below, atomic with this same order row.
          // A partial wallet + ONLINE order defers the debit to payment
          // confirmation instead (payments.service.js#verifyPayment / the
          // Razorpay webhook) — so a cancelled/failed Razorpay attempt
          // never had anything taken from the wallet to roll back.
          walletDebited: debitNow,
          clientOrderRef: payload.clientOrderRef || null,
        })

        if (group.walletAmount > 0 && debitNow) {
          const wallet = await this.walletRepo.getForUpdate(client, customerId)
          if (!wallet || Number(wallet.balance) < group.walletAmount) {
            // Balance changed since the read above (spent concurrently on
            // another device) — fail the whole order rather than silently
            // charging less wallet than the bill already promised.
            const err = new Error('Your wallet balance changed just now — please try again.')
            err.statusCode = 409
            err.code = 'WALLET_BALANCE_CHANGED'
            throw err
          }
          await this.walletRepo.debit(
            client, wallet.id, group.walletAmount,
            `Payment for order ${orderNumber}`, row.id, { orderId: row.id }
          )
        }

        const orderItemIds = row._orderItemIds || []
        for (let i = 0; i < group.items.length; i++) {
          const item = group.items[i]
          await this.shopProductsRepo.applyStockChange(client, {
            shopProductId: item.shopProductId,
            delta: -item.quantity,
            type: 'ORDER_DEDUCTION',
            source: 'ORDER',
            orderId: row.id,
            reason: `Order ${orderNumber}`,
          })

          // Best-effort vendor-batch traceability (never blocks the sale —
          // see InventoryService#consumeForOrderItem's own doc comment).
          const orderItemId = orderItemIds[i]
          if (orderItemId && item.productId) {
            try {
              const warehouseId = await this.vendorProcurementRepo.ensureShopWarehouse(group.shopId)
              await this.inventoryService.consumeForOrderItem(
                customerId,
                { warehouseId, productId: item.productId, orderItemId, quantity: item.quantity },
                client
              )
            } catch (err) {
              logger.warn(
                { err, orderItemId, productId: item.productId, shopId: group.shopId },
                'Inventory lot allocation failed for order item — order placement unaffected'
              )
            }
          }
        }
        await this.repository.logStatusTransition(
          row.id, null, 'ORDER_PLACED', customerId, 'Order placed from mobile checkout', client
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

    // COD is confirmed (and, same as before, paid-in-full-by-wallet orders
    // of either method) clears the cart immediately. A genuinely
    // outstanding ONLINE balance keeps the cart until Razorpay verification
    // succeeds, so a cancelled payment is retryable.
    const anyWalletCoveredInFull = created.some((order) => order.paymentStatus === 'PAID')
    if (payload.paymentMethod === 'COD' || anyWalletCoveredInFull) {
      await this.cartRepo.clearCart(customerId, priceMode)
      await this.cartRepo.clearExtras(customerId, priceMode)

      // Coupon usage is recorded now — the order is already confirmed paid
      // (or COD, collected on delivery). An ONLINE order with money still
      // outstanding records usage at payment confirmation instead, exactly
      // as it always has (payments.service.js#verifyPayment / the webhook).
      if (payload.couponCode && couponResult?.valid) {
        for (const order of created) {
          try {
            await this.couponsService.recordUsageForOrder(order.id)
          } catch (err) {
            logger.warn({ err: err.message, orderId: order.id }, 'Coupon usage recording failed at placement (non-critical)')
          }
        }
      }
    }

    logger.info({ customerId, orderIds: created.map((order) => order.id) }, 'Mobile checkout completed')
    return { order: created[0], orders: created }
  }

  /** Splits `amount` across `weights`' proportional shares in paise, summing back to exactly `amount` (largest-remainder method). */
  _splitProportional(amount, weights) {
    const total = weights.reduce((sum, w) => sum + w, 0)
    if (amount <= 0 || total <= 0) {
      return weights.map(() => 0)
    }
    const totalCents = Math.round(amount * 100)
    const idealCents = weights.map((w) => (w / total) * totalCents)
    const flooredCents = idealCents.map((c) => Math.floor(c))
    const remainders = idealCents.map((c, i) => c - flooredCents[i])
    const distributed = flooredCents.reduce((sum, c) => sum + c, 0)
    const residue = totalCents - distributed
    const order = remainders.map((r, i) => ({ r, i })).sort((a, b) => b.r - a.r)
    for (let k = 0; k < residue; k++) {
      flooredCents[order[k % order.length].i] += 1
    }
    return flooredCents.map((c) => Number((c / 100).toFixed(2)))
  }

  /** Most recent order still in progress — powers the mobile "track your order" banner. */
  async getActiveOrder(customerId) {
    return this.repository.getActiveOrder(customerId)
  }

  /**
   * Customer-initiated cancel — used by the mobile app when its own
   * Razorpay checkout fails or is dismissed by the user before payment
   * ever completed. Refuses to touch an order the backend already has
   * marked PAID (a captured payment must never be silently orphaned) —
   * the mobile app's cancel/reorder helpers already know to treat that
   * exact `{paymentConfirmed:true}` shape as "actually succeeded, go to
   * the success screen" instead of a failure (see
   * checkout_provider.dart#_tryCancelOrder).
   */
  async cancelOrder(customerId, orderId, reason) {
    const order = await this.repository.findByIdAndUser(orderId, customerId)
    if (!order) {
      const err = new Error('Order not found')
      err.statusCode = 404
      err.code = 'ORDER_NOT_FOUND'
      throw err
    }

    if (order.paymentStatus === 'PAID') {
      return { alreadyCancelled: false, paymentConfirmed: true, order }
    }

    if (order.status === 'CANCELLED') {
      // Idempotent — a duplicate cancel call (double tap, retry) is a
      // harmless no-op rather than an error.
      return { alreadyCancelled: true, paymentConfirmed: false, order }
    }

    const client = await getClient()
    try {
      await client.query('BEGIN')
      await client.query(
        `UPDATE orders SET status = 'CANCELLED', payment_status = 'FAILED', updated_at = NOW() WHERE id = $1`,
        [orderId]
      )
      const items = await this.repository.getOrderItems(orderId)
      await this.shopProductsRepo.restoreStockForCancelledOrder(client, {
        orderId,
        items,
        source: 'API',
        actor: { userId: customerId },
      })
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    await this.repository.logStatusTransition(orderId, order.status, 'CANCELLED', customerId, reason || 'Cancelled by customer')
    logger.info({ customerId, orderId, reason }, 'Order cancelled by customer')

    const updated = await this.repository.findByIdAndUser(orderId, customerId)
    return { alreadyCancelled: false, paymentConfirmed: false, order: updated }
  }

  /**
   * Re-adds every item from a past order back into the customer's live
   * cart. Two call patterns hit this same endpoint: the explicit "Reorder"
   * / "Buy Again" button (orders_screen.dart, order_detail_screen.dart —
   * via `ReorderUseCase`, which reads `itemCount`/`warnings` from the
   * response and navigates to the cart) and a best-effort follow-up after
   * a failed/cancelled online payment (checkout_provider.dart
   * #_tryCancelOrder, payment_provider.dart#_cancelPendingOrder) meant to
   * restore the customer's cart contents so a failed payment doesn't also
   * cost them their selection.
   *
   * Previously this was a hard no-op — `return { orderId, status }` — with
   * a comment rationalizing it as deliberate ("stock restoration already
   * happens inside cancelOrder, so this is a safe no-op rather than a
   * second restock"). That reasoning only ever covered why it shouldn't
   * touch stock; it never actually added anything to the cart either, so
   * both the "Buy Again" button and the post-cancel cart-restore did
   * nothing at all — a tap on "Buy Again" always showed the mobile
   * client's canned "Items added to cart" success toast while the cart
   * stayed exactly as it was. Stock is untouched here on purpose — adding
   * to the cart doesn't decrement it (only `placeOrder` does); that part
   * of the reasoning was correct even though the conclusion it was
   * attached to (return nothing) wasn't.
   *
   * `order.items` is the JSONB snapshot already written onto the order row
   * at checkout (`createCheckoutOrder`, `data.items`), so no join is
   * needed. Each item is added independently through the same
   * `CartService.addItem` a live `/cart/items` call uses — a product that's
   * gone out of stock or been deleted since is reported as a per-item
   * warning instead of failing the whole reorder. Price mode defaults to
   * 'retail': the order row doesn't persist which mode it was placed
   * under.
   */
  async reorder(customerId, orderId) {
    const order = await this.repository.findByIdAndUser(orderId, customerId)
    if (!order) {
      const err = new Error('Order not found')
      err.statusCode = 404
      err.code = 'ORDER_NOT_FOUND'
      throw err
    }

    const items = Array.isArray(order.items) ? order.items : []
    const warnings = []
    let itemCount = 0

    for (const item of items) {
      const productId = item?.productId
      const quantity = Number(item?.quantity) || 1
      if (!productId) continue

      const result = await this.cartService.addItem(customerId, {
        productId,
        quantity,
        priceMode: 'retail',
      })
      if (result?.success === false) {
        warnings.push(`${item?.name || 'An item'}: ${result.message || 'could not be added'}`)
      } else {
        itemCount += 1
      }
    }

    return { orderId, status: order.status, itemCount, warnings }
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

  /**
   * Resolves, per order line, the vendor quality/cleaning video that
   * actually backed the batch sold to this customer — what the invoice QR
   * scan opens. Ownership-scoped the same way as every other self-service
   * order endpoint (§7.2 point 10's IDOR fix): always the caller's own
   * order, never a client-supplied id. An item with no traceable
   * allocation (e.g. it was stocked manually, outside vendor procurement)
   * simply gets `video: null` rather than an error — this is a bonus
   * trust signal, not a required part of viewing an order.
   */
  async getQualityVideos(userId, orderId) {
    const order = await this.repository.findOrderById(orderId)
    if (!order) {
      return { success: false, statusCode: 404, message: 'Order not found' }
    }
    if (order.customer_id !== userId) {
      return { success: false, statusCode: 403, message: 'Access denied' }
    }

    const items = order.items || []
    const orderItemIds = items.map((item) => item.id).filter(Boolean)
    const trace = await this.inventoryService.getQualityTraceForOrderItems(orderItemIds)

    // findQualityTraceForOrderItems orders by quantity_allocated DESC per
    // item, so the first row seen per order_item_id is already the lot
    // that supplied the largest share of that line (the "primary" batch
    // when a sale spans an old lot's tail end plus a newly-arrived one).
    const primaryByItem = new Map()
    for (const row of trace) {
      if (!primaryByItem.has(row.order_item_id)) {
        primaryByItem.set(row.order_item_id, row)
      }
    }

    const results = items.map((item) => {
      const match = primaryByItem.get(item.id)
      if (!match || !match.video_url) {
        return { orderItemId: item.id, productName: item.name, video: null }
      }
      return {
        orderItemId: item.id,
        productName: item.name,
        video: {
          url: match.video_url,
          vendorName: match.vendor_name,
          supplyNumber: match.supply_number,
        },
      }
    })

    return { success: true, orderId, orderNumber: order.order_number, items: results }
  }
}
