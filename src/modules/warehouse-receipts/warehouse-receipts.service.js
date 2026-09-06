/**
 * Warehouse Receipts Service — Business Logic & QC Inspection Engine
 * Source of truth: Blueprint §06.4, Phase 5A
 *
 * @module modules/warehouse-receipts/warehouse-receipts.service
 */

import crypto from 'node:crypto'
import { logger } from '../../config/logger.js'

const RECEIPT_TRANSITIONS = {
  PENDING_RECEIPT: ['RECEIVING'],
  RECEIVING: ['QC_PENDING'],
  QC_PENDING: ['QC_APPROVED', 'QC_REJECTED'],
  QC_APPROVED: ['RECEIVED'],
  QC_REJECTED: ['RETURNED'],
  RECEIVED: [],
  RETURNED: [],
}

export class WarehouseReceiptsService {
  /**
   * @param {import('./warehouse-receipts.repository.js').WarehouseReceiptsRepository} repository
   */
  constructor(repository) {
    this.repository = repository
  }

  validateStateTransition(currentStatus, nextStatus) {
    const allowed = RECEIPT_TRANSITIONS[currentStatus] || []
    if (!allowed.includes(nextStatus)) {
      const err = new Error(`Invalid state transition from ${currentStatus} to ${nextStatus}`)
      err.statusCode = 400
      err.code = 'INVALID_STATE_TRANSITION'
      throw err
    }
  }

  async createReceipt(actorId, payload) {
    const receiptNumber = `WR-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`
    const receipt = await this.repository.createReceipt(
      payload.warehouse_id,
      payload.procurement_order_id || null,
      receiptNumber,
      actorId,
      payload.notes || null
    )

    const items = []
    for (const itemData of payload.items) {
      const item = await this.repository.addReceiptItem(receipt.id, itemData)
      items.push(item)
    }

    await this.repository.logAudit({
      receiptId: receipt.id,
      actorId,
      action: 'CREATE',
      newStatus: 'PENDING_RECEIPT',
      comments: 'Warehouse receipt registered',
    })

    logger.info({ receiptId: receipt.id, receiptNumber }, 'Warehouse receipt created')
    return { ...receipt, items }
  }

  async startReceiving(receiptId, warehouseId, actorId) {
    const receipt = await this.repository.findReceiptById(receiptId)
    if (!receipt) {
      const err = new Error('Warehouse receipt not found')
      err.statusCode = 404
      err.code = 'RECEIPT_NOT_FOUND'
      throw err
    }

    if (receipt.warehouse_id !== warehouseId) {
      const err = new Error('Forbidden — receipt does not belong to your warehouse')
      err.statusCode = 403
      err.code = 'CROSS_WAREHOUSE_ACCESS_DENIED'
      throw err
    }

    this.validateStateTransition(receipt.status, 'RECEIVING')
    const updated = await this.repository.updateReceiptStatus(receiptId, 'RECEIVING')

    await this.repository.logAudit({
      receiptId,
      actorId,
      action: 'START_RECEIVING',
      previousStatus: receipt.status,
      newStatus: 'RECEIVING',
    })

    return updated
  }

  async submitForQc(receiptId, warehouseId, actorId) {
    const receipt = await this.repository.findReceiptById(receiptId)
    if (!receipt) {
      const err = new Error('Warehouse receipt not found')
      err.statusCode = 404
      err.code = 'RECEIPT_NOT_FOUND'
      throw err
    }

    if (receipt.warehouse_id !== warehouseId) {
      const err = new Error('Forbidden — receipt does not belong to your warehouse')
      err.statusCode = 403
      err.code = 'CROSS_WAREHOUSE_ACCESS_DENIED'
      throw err
    }

    this.validateStateTransition(receipt.status, 'QC_PENDING')
    const updated = await this.repository.updateReceiptStatus(receiptId, 'QC_PENDING')

    await this.repository.logAudit({
      receiptId,
      actorId,
      action: 'SUBMIT_QC',
      previousStatus: receipt.status,
      newStatus: 'QC_PENDING',
    })

    return updated
  }

  async performQcInspection(receiptId, inspectorId, payload) {
    const receipt = await this.repository.findReceiptById(receiptId)
    if (!receipt) {
      const err = new Error('Warehouse receipt not found')
      err.statusCode = 404
      err.code = 'RECEIPT_NOT_FOUND'
      throw err
    }

    if (receipt.status !== 'QC_PENDING') {
      const err = new Error(`Cannot perform QC inspection when status is ${receipt.status}`)
      err.statusCode = 400
      err.code = 'INVALID_QC_STATUS'
      throw err
    }

    // Process item quantities and parameters
    for (const itemRes of payload.item_results) {
      const item = receipt.items.find(i => i.id === itemRes.receipt_item_id)
      if (!item) {
        const err = new Error(`Receipt item ${itemRes.receipt_item_id} not found`)
        err.statusCode = 404
        err.code = 'ITEM_NOT_FOUND'
        throw err
      }

      const totalQuantity = Number(itemRes.quantity_accepted) + Number(itemRes.quantity_rejected)
      if (totalQuantity > Number(item.quantity_received)) {
        const err = new Error(`Accepted + rejected quantity (${totalQuantity}) exceeds received quantity (${item.quantity_received})`)
        err.statusCode = 400
        err.code = 'EXCEEDS_RECEIVED_QUANTITY'
        throw err
      }

      await this.repository.updateItemQuantities(itemRes.receipt_item_id, itemRes.quantity_accepted, itemRes.quantity_rejected)
    }

    const inspection = await this.repository.createInspection(receiptId, inspectorId, payload.result, payload.notes || null)

    const targetStatus = payload.result === 'FAIL' ? 'QC_REJECTED' : 'QC_APPROVED'
    this.validateStateTransition(receipt.status, targetStatus)
    let updatedReceipt = await this.repository.updateReceiptStatus(receiptId, targetStatus)

    // Complete receipt if approved -> RECEIVED
    if (targetStatus === 'QC_APPROVED') {
      this.validateStateTransition('QC_APPROVED', 'RECEIVED')
      updatedReceipt = await this.repository.updateReceiptStatus(receiptId, 'RECEIVED')
    } else if (targetStatus === 'QC_REJECTED') {
      this.validateStateTransition('QC_REJECTED', 'RETURNED')
      updatedReceipt = await this.repository.updateReceiptStatus(receiptId, 'RETURNED')
    }

    await this.repository.logAudit({
      receiptId,
      actorId: inspectorId,
      action: 'QC_INSPECTION',
      previousStatus: receipt.status,
      newStatus: updatedReceipt.status,
      comments: `QC result: ${payload.result}`,
    })

    logger.info({ receiptId, qcResult: payload.result, finalStatus: updatedReceipt.status }, 'QC inspection completed')
    return { receipt: updatedReceipt, inspection }
  }

  async getReceiptById(receiptId) {
    const receipt = await this.repository.findReceiptById(receiptId)
    if (!receipt) {
      const err = new Error('Warehouse receipt not found')
      err.statusCode = 404
      err.code = 'RECEIPT_NOT_FOUND'
      throw err
    }
    return receipt
  }

  async listReceipts(params) {
    return this.repository.listReceipts(params)
  }
}
