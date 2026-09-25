import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Mock external dependencies BEFORE importing service ─
vi.mock('../../../src/config/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../../src/config/bullmq.js', () => ({
  orderQueue: { add: vi.fn() },
}))

vi.mock('../../../src/utils/pushNotification.js', () => ({
  sendPush: vi.fn(),
}))

vi.mock('../../../src/modules/uploads/uploads.service.js', () => ({
  UploadsService: class {
    uploadImage = vi.fn()
  },
}))

vi.mock('../../../src/modules/cashback/cashback.service.js', () => ({
  CashbackService: class {
    evaluateAndCredit = vi.fn()
  },
}))

import { DeliveryService } from '../../../src/modules/delivery/delivery.service.js'

function createRepositoryMock() {
  return {
    getRiderProfile: vi.fn(),
    toggleOnline: vi.fn(),
    getAssignmentByOrderAndRider: vi.fn(),
    getOrderAssignmentSnapshot: vi.fn(),
    acceptOrder: vi.fn(),
    rejectOrder: vi.fn(),
    markPickedUp: vi.fn(),
    markDelivered: vi.fn(),
    verifyDeliveryOtp: vi.fn(),
    storeDeliveryOtp: vi.fn(),
    saveProofPhoto: vi.fn(),
    getAssignedOrders: vi.fn(),
    getStoreSettings: vi.fn(),
    getDeliveryStats: vi.fn(),
    getDeliveryEarnings: vi.fn(),
    getDeliveryPayouts: vi.fn(),
    getDeliveryCompletionSummary: vi.fn(),
    updateLocation: vi.fn(),
    getDeliveryHistory: vi.fn(),
  }
}

function createService(repository) {
  const service = new DeliveryService(repository, {})
  service._emitOrderUpdate = vi.fn()
  service._emitOrderExpired = vi.fn()
  service._queueNotification = vi.fn()
  service._queueAutoAssign = vi.fn()
  service._runAutoAssignFallback = vi.fn()
  service._queueBacklogAssignScan = vi.fn()
  return service
}

describe('DeliveryService toggleOnline eligibility gates', () => {
  let repository
  let service

  beforeEach(() => {
    repository = createRepositoryMock()
    service = createService(repository)
  })

  it('rejects with RIDER_NOT_FOUND when the profile is missing', async () => {
    repository.getRiderProfile.mockResolvedValue(null)

    await expect(service.toggleOnline('rider-1', true)).rejects.toMatchObject({
      statusCode: 404,
      code: 'RIDER_NOT_FOUND',
    })
    expect(repository.toggleOnline).not.toHaveBeenCalled()
  })

  it('rejects with RIDER_NOT_APPROVED when the profile is unapproved', async () => {
    repository.getRiderProfile.mockResolvedValue({
      user_id: 'rider-1',
      is_approved: false,
      is_active: true,
    })

    await expect(service.toggleOnline('rider-1', true)).rejects.toMatchObject({
      statusCode: 403,
      code: 'RIDER_NOT_APPROVED',
    })
    expect(repository.toggleOnline).not.toHaveBeenCalled()
  })

  it('rejects with RIDER_SUSPENDED when a suspended rider tries to go online', async () => {
    repository.getRiderProfile.mockResolvedValue({
      user_id: 'rider-1',
      is_approved: true,
      is_active: false,
    })

    await expect(service.toggleOnline('rider-1', true)).rejects.toMatchObject({
      statusCode: 403,
      code: 'RIDER_SUSPENDED',
    })
    expect(repository.toggleOnline).not.toHaveBeenCalled()
    expect(service._queueBacklogAssignScan).not.toHaveBeenCalled()
  })

  it('still allows a suspended rider to go offline (harmless direction)', async () => {
    repository.getRiderProfile.mockResolvedValue({
      user_id: 'rider-1',
      is_approved: true,
      is_active: false,
    })
    repository.toggleOnline.mockResolvedValue({ user_id: 'rider-1', is_online: false })

    await expect(service.toggleOnline('rider-1', false)).resolves.toMatchObject({
      is_online: false,
    })
    expect(repository.toggleOnline).toHaveBeenCalledWith('rider-1', false)
  })

  it('lets an approved active rider go online and queues a backlog scan', async () => {
    repository.getRiderProfile.mockResolvedValue({
      user_id: 'rider-1',
      is_approved: true,
      is_active: true,
    })
    repository.toggleOnline.mockResolvedValue({ user_id: 'rider-1', is_online: true })

    await expect(service.toggleOnline('rider-1', true)).resolves.toMatchObject({
      is_online: true,
    })
    expect(repository.toggleOnline).toHaveBeenCalledWith('rider-1', true)
    expect(service._queueBacklogAssignScan).toHaveBeenCalledWith('RIDER_WENT_ONLINE')
  })
})
