import { describe, expect, it, vi } from 'vitest'
import { InventoryRepository } from '../../../src/modules/inventory/inventory.repository.js'

describe('Inventory Repository — FEFO & Concurrency Quantity Guard (Spec §5.4.1, §7.8.2, §7.8.5)', () => {
  it('findAvailableLotsFefo appends FOR UPDATE SKIP LOCKED and filters state = AVAILABLE', async () => {
    const repo = new InventoryRepository()
    const mockQuery = vi.fn().mockResolvedValue({ rows: [] })
    const mockClient = { query: mockQuery }

    await repo.findAvailableLotsFefo('w-1', 'p-1', mockClient)

    expect(mockQuery).toHaveBeenCalledTimes(1)
    const sql = mockQuery.mock.calls[0][0]
    expect(sql).toContain('FOR UPDATE SKIP LOCKED')
    expect(sql).toContain("state = 'AVAILABLE'")
    expect(sql).toContain('ORDER BY expiry_date ASC, created_at ASC')
  })

  it('reserveLotQuantityGuard uses atomic SQL update checking (quantity_on_hand - quantity_reserved) >= $2', async () => {
    const repo = new InventoryRepository()
    const mockQuery = vi.fn().mockResolvedValue({
      rows: [{ id: 'lot-1', quantity_on_hand: 10, quantity_reserved: 3, version: 2 }],
    })
    const mockClient = { query: mockQuery }

    const result = await repo.reserveLotQuantityGuard('lot-1', 3, mockClient)

    expect(result).not.toBeNull()
    expect(result.id).toBe('lot-1')
    expect(mockQuery).toHaveBeenCalledTimes(1)
    const sql = mockQuery.mock.calls[0][0]
    expect(sql).toContain('(quantity_on_hand - quantity_reserved) >= $2')
    expect(sql).toContain('version = version + 1')
  })
})
