import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../src/config/database.js', () => ({ query: vi.fn(), getClient: vi.fn() }))
import { query } from '../../../src/config/database.js'
import { OrdersRepository } from '../../../src/modules/orders/orders.repository.js'
import { OrdersService } from '../../../src/modules/orders/orders.service.js'

describe('OrdersRepository#getTrackingSnapshot', () => {
  beforeEach(() => vi.clearAllMocks())
  const base = {
    rider_id: 'r1', rider_name: 'Ravi', rider_phone: '99', vehicle_number: 'WB1',
    current_lat: '22.57', current_lng: '88.36', location_updated_at: '2026-10-02T10:00:00Z',
    shop_name: 'FreshCuts', shop_lat: '22.58', shop_lng: '88.35',
    delivery_address: { lat: 22.6, lng: 88.4 },
  }

  it('is TO_STORE while the rider has only accepted, with store + rider + destination', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...base, assignment_status: 'ACCEPTED' }] })
    const t = await new OrdersRepository().getTrackingSnapshot('o1')
    expect(t.phase).toBe('TO_STORE')
    expect(t.rider.name).toBe('Ravi')
    expect(t.riderLocation).toMatchObject({ lat: 22.57, lng: 88.36 })
    expect(t.store).toEqual({ name: 'FreshCuts', lat: 22.58, lng: 88.35 })
    expect(t.destination).toEqual({ lat: 22.6, lng: 88.4 })
  })

  it('is TO_CUSTOMER after pickup and tolerates a JSON-string address', async () => {
    query.mockResolvedValueOnce({
      rows: [{ ...base, assignment_status: 'IN_TRANSIT', delivery_address: '{"latitude":1,"longitude":2}' }],
    })
    const t = await new OrdersRepository().getTrackingSnapshot('o1')
    expect(t.phase).toBe('TO_CUSTOMER')
    expect(t.destination).toEqual({ lat: 1, lng: 2 })
  })

  it('returns null with no rider and never invents coordinates', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    expect(await new OrdersRepository().getTrackingSnapshot('o1')).toBeNull()
    query.mockResolvedValueOnce({ rows: [{ ...base, assignment_status: 'ACCEPTED', current_lat: null, shop_lat: null }] })
    const t = await new OrdersRepository().getTrackingSnapshot('o1')
    expect(t.riderLocation).toBeNull()
    expect(t.store).toBeNull()
  })
})

describe('OrdersService#_withTracking', () => {
  it('attaches tracking for live orders, skips terminal ones, survives errors', async () => {
    const repo = { getTrackingSnapshot: vi.fn().mockResolvedValue({ phase: 'TO_STORE' }) }
    const svc = new OrdersService(repo, {})
    expect((await svc._withTracking({ id: 'o', status: 'PACKED' })).tracking).toEqual({ phase: 'TO_STORE' })
    expect((await svc._withTracking({ id: 'o', status: 'DELIVERED' })).tracking).toBeUndefined()
    repo.getTrackingSnapshot.mockRejectedValue(new Error('x'))
    expect((await svc._withTracking({ id: 'o', status: 'PACKED' })).tracking).toBeUndefined()
  })
})
