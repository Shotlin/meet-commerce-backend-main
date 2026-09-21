// validate-pincode (gate G1): PIN normalisation + the in-process PIN cache that
// ShopsService now invalidates when a shop's service area changes.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const databaseMock = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('../../../src/config/database.js', () => databaseMock)
vi.mock('../../../src/config/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('../../../src/config/env.js', () => ({ env: { ALLOW_ALL_PINCODES: false } }))

import { AddressesService } from '../../../src/modules/addresses/addresses.service.js'
import { invalidateServiceablePincodeCache } from '../../../src/utils/serviceable-pincode-cache.js'

function makeService() {
  return new AddressesService({}, {
    allocationRepository: {},
    pincodeMappingsRepository: { findActiveByPincode: vi.fn().mockResolvedValue(null) },
    feeSettingsRepository: { getGlobal: vi.fn().mockResolvedValue({ delivery_eta_minutes: 30 }) },
  })
}

const shopsWithPins = (...pins) => ({ rows: pins.map((pincode) => ({ pincode })) })

beforeEach(() => {
  vi.clearAllMocks()
  invalidateServiceablePincodeCache()
})

describe('AddressesService.validatePincode()', () => {
  it('is available for a configured PIN and unavailable for another', async () => {
    databaseMock.query.mockResolvedValue(shopsWithPins('201301'))
    const service = makeService()

    expect((await service.validatePincode('201301')).available).toBe(true)
    expect((await service.validatePincode('201302')).available).toBe(false)
  })

  it('duplicate / whitespace-padded stored entries behave as one clean PIN', async () => {
    databaseMock.query.mockResolvedValue(shopsWithPins('201301', ' 201301', '201301 ', '', '   '))
    const service = makeService()

    expect((await service.validatePincode('201301')).available).toBe(true)
    expect((await service.validatePincode(' 201301 ')).available).toBe(true)
    expect((await service.validatePincode('201302')).available).toBe(false)
  })

  it('caches the PIN set, and stays fresh after invalidateServiceablePincodeCache()', async () => {
    databaseMock.query.mockResolvedValueOnce(shopsWithPins('700016'))
    const service = makeService()

    expect((await service.validatePincode('201301')).available).toBe(false)
    expect(databaseMock.query).toHaveBeenCalledTimes(1)

    // Dashboard adds 201301 — without invalidation the stale set would still answer "no".
    databaseMock.query.mockResolvedValueOnce(shopsWithPins('700016', '201301'))
    expect((await service.validatePincode('201301')).available).toBe(false)
    expect(databaseMock.query).toHaveBeenCalledTimes(1)

    invalidateServiceablePincodeCache()
    expect((await service.validatePincode('201301')).available).toBe(true)
    expect(databaseMock.query).toHaveBeenCalledTimes(2)
  })

  it('allows all when no shop has any PIN configured (unchanged) and does not cache that', async () => {
    databaseMock.query.mockResolvedValue({ rows: [] })
    const service = makeService()

    expect((await service.validatePincode('201301')).available).toBe(true)
    expect((await service.validatePincode('201301')).available).toBe(true)
    expect(databaseMock.query).toHaveBeenCalledTimes(2)
  })
})
