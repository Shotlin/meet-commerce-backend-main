/**
 * Cart, Loyalty & Quote Service — Business Logic Engine
 * Source of truth: Blueprint §06.6, Phase 7
 *
 * @module modules/cart-quote/cart-quote.service
 */

import crypto from 'node:crypto'
import { logger } from '../../config/logger.js'

export class CartQuoteService {
  /**
   * @param {import('./cart-quote.repository.js').CartQuoteRepository} repository
   */
  constructor(repository) {
    this.repository = repository
  }

  // ─── CART SERVICES ──────────────────────────────────
  async getCart(customerId) {
    return this.repository.getCartWithItems(customerId)
  }

  async addItem(customerId, payload) {
    const { product_id, quantity } = payload
    const product = await this.repository.findProductById(product_id)

    if (!product || product.is_active === false || product.status === 'INACTIVE') {
      const err = new Error('Product is unavailable or out of stock')
      err.statusCode = 400
      err.code = 'UNAVAILABLE_PRODUCT_REJECTED'
      throw err
    }

    const cart = await this.repository.findOrCreateCart(customerId)
    const productSnapshot = {
      id: product.id,
      name: product.name,
      slug: product.slug,
      unit_price: product.price,
      currency: product.currency || 'INR',
    }

    const item = await this.repository.addOrUpdateCartItem(
      cart.id,
      product_id,
      quantity,
      product.price,
      productSnapshot
    )

    logger.info({ customerId, cartId: cart.id, productId: product_id, quantity }, 'Cart item added')
    return this.repository.getCartWithItems(customerId)
  }

  async updateItemQuantity(customerId, productId, quantity) {
    const cart = await this.repository.findOrCreateCart(customerId)
    const updated = await this.repository.updateCartItemQuantity(cart.id, productId, quantity)

    if (!updated) {
      const err = new Error('Cart item not found')
      err.statusCode = 404
      err.code = 'CART_ITEM_NOT_FOUND'
      throw err
    }

    return this.repository.getCartWithItems(customerId)
  }

  async removeItem(customerId, productId) {
    const cart = await this.repository.findOrCreateCart(customerId)
    const removed = await this.repository.removeCartItem(cart.id, productId)
    if (!removed) {
      const err = new Error('Cart item not found')
      err.statusCode = 404
      err.code = 'CART_ITEM_NOT_FOUND'
      throw err
    }
    return this.repository.getCartWithItems(customerId)
  }

  async clearCart(customerId) {
    const cart = await this.repository.findOrCreateCart(customerId)
    await this.repository.clearCart(cart.id)
    return { success: true, message: 'Cart cleared' }
  }

  // ─── LOYALTY LEDGER SERVICES ────────────────────────
  async getLoyaltyHistory(customerId) {
    return this.repository.getLoyaltyHistory(customerId)
  }

  async processLoyaltyTransaction(customerId, payload) {
    const { transaction_type, points, reference_id = null, idempotency_key = null } = payload

    if (idempotency_key) {
      const existingTx = await this.repository.findLoyaltyTxByIdempotencyKey(idempotency_key)
      if (existingTx) {
        logger.info({ idempotency_key }, 'Duplicate loyalty transaction skipped via idempotency key')
        return existingTx
      }
    }

    const account = await this.repository.findOrCreateLoyaltyAccount(customerId)
    const currentBalance = Number(account.points_balance)
    let newBalance = currentBalance

    if (transaction_type === 'EARN' || transaction_type === 'ADJUSTMENT') {
      newBalance += Number(points)
    } else if (transaction_type === 'REDEEM' || transaction_type === 'EXPIRE') {
      if (currentBalance < Number(points)) {
        const err = new Error(`Insufficient loyalty balance. Required: ${points}, Available: ${currentBalance}`)
        err.statusCode = 400
        err.code = 'INSUFFICIENT_LOYALTY_BALANCE'
        throw err
      }
      newBalance -= Number(points)
    }

    const tx = await this.repository.writeLoyaltyTransaction(
      account.id,
      transaction_type,
      Number(points),
      newBalance,
      reference_id,
      idempotency_key
    )

    logger.info({ customerId, transaction_type, points, newBalance }, 'Loyalty transaction recorded')
    return tx
  }

  // ─── CHECKOUT QUOTE SERVICES ───────────────────────
  async generateCheckoutQuote(customerId, payload = {}) {
    const { loyalty_points_to_redeem = 0, discount_code = null, ttl_seconds = 900 } = payload
    const cart = await this.repository.getCartWithItems(customerId)

    if (!cart.items || cart.items.length === 0) {
      const err = new Error('Cart is empty. Cannot generate checkout quote.')
      err.statusCode = 400
      err.code = 'EMPTY_CART_QUOTE_REJECTED'
      throw err
    }

    // Validate product availability and snapshot prices
    let subtotal = 0
    const snapshotItems = []

    for (const item of cart.items) {
      const itemSubtotal = Number(item.unit_price) * Number(item.quantity)
      subtotal += itemSubtotal
      snapshotItems.push({
        product_id: item.product_id,
        name: item.product_name,
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price),
        subtotal: itemSubtotal,
      })
    }

    // Process discounts
    let discountAmount = 0
    if (discount_code) {
      discountAmount = Math.min(subtotal * 0.1, 100) // 10% sample discount up to 100
    }

    // Process loyalty redemption (1 point = 1 INR discount)
    let loyaltyRedeemedAmount = 0
    if (loyalty_points_to_redeem > 0) {
      const loyaltyAccount = await this.repository.findOrCreateLoyaltyAccount(customerId)
      const currentPoints = Number(loyaltyAccount.points_balance)

      if (currentPoints < loyalty_points_to_redeem) {
        const err = new Error(`Cannot redeem ${loyalty_points_to_redeem} points. Available: ${currentPoints}`)
        err.statusCode = 400
        err.code = 'INSUFFICIENT_LOYALTY_BALANCE'
        throw err
      }

      loyaltyRedeemedAmount = Math.min(loyalty_points_to_redeem, subtotal - discountAmount)
    }

    // Tax calculation (5% sample GST)
    const taxableAmount = Math.max(0, subtotal - discountAmount - loyaltyRedeemedAmount)
    const taxAmount = Number((taxableAmount * 0.05).toFixed(2))
    const totalPayable = Number((taxableAmount + taxAmount).toFixed(2))

    const quoteNumber = `Q-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`
    const expiresAt = new Date(Date.now() + ttl_seconds * 1000)

    const quote = await this.repository.createQuote({
      quote_number: quoteNumber,
      customer_id: customerId,
      cart_snapshot: { items: snapshotItems },
      subtotal,
      discount_amount: discountAmount,
      loyalty_redeemed_amount: loyaltyRedeemedAmount,
      tax_amount: taxAmount,
      total_payable: totalPayable,
      expires_at: expiresAt,
    })

    logger.info({ quoteNumber, customerId, totalPayable, expiresAt }, 'Checkout quote generated')
    return quote
  }

  async getQuoteByNumber(quoteNumber) {
    const quote = await this.repository.findQuoteByNumber(quoteNumber)
    if (!quote) {
      const err = new Error('Checkout quote not found')
      err.statusCode = 404
      err.code = 'QUOTE_NOT_FOUND'
      throw err
    }

    if (new Date(quote.expires_at) <= new Date()) {
      const err = new Error('Checkout quote has expired')
      err.statusCode = 400
      err.code = 'QUOTE_EXPIRED'
      throw err
    }

    return quote
  }
}
