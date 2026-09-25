import { describe, expect, it, vi } from 'vitest'
import { InventoryRepository } from '../../../src/modules/inventory/inventory.repository.js'

describe('Inventory Repository — FEFO & Concurrency Quantity Guard (Spec §5.4.1, §7.8.2, §7.8.5)', () => {
  // `inventory_lots` (migration 104) has no `state`/`version` columns —
  // the query used to reference both and would have thrown "column does
  // not exist" the moment it was ever called in production; it never was
  // (reserveFefo has no callers), which is how it stayed unnoticed until
  // it was fixed to match the real deployed schema. These assertions were
  // pinned to the bug itself; updated to the corrected SQL.
  it('findAvailableLotsFefo appends FOR UPDATE SKIP LOCKED, filters on real availability/expiry columns only', async () => {
    const repo = new InventoryRepository()
    const mockQuery = vi.fn().mockResolvedValue({ rows: [] })
    const mockClient = { query: mockQuery }

    await repo.findAvailableLotsFefo('w-1', 'p-1', mockClient)

    expect(mockQuery).toHaveBeenCalledTimes(1)
    const sql = mockQuery.mock.calls[0][0]
    expect(sql).toContain('FOR UPDATE SKIP LOCKED')
    expect(sql).not.toContain('state')
    expect(sql).not.toContain('version')
    expect(sql).toContain('expiry_date > CURRENT_DATE')
    expect(sql).toContain('(quantity_on_hand - quantity_reserved) > 0')
    expect(sql).toContain('ORDER BY expiry_date ASC, created_at ASC')
  })

  it('reserveLotQuantityGuard uses atomic SQL update checking (quantity_on_hand - quantity_reserved) >= $2', async () => {
    const repo = new InventoryRepository()
    const mockQuery = vi.fn().mockResolvedValue({
      rows: [{ id: 'lot-1', quantity_on_hand: 10, quantity_reserved: 3 }],
    })
    const mockClient = { query: mockQuery }

    const result = await repo.reserveLotQuantityGuard('lot-1', 3, mockClient)

    expect(result).not.toBeNull()
    expect(result.id).toBe('lot-1')
    expect(mockQuery).toHaveBeenCalledTimes(1)
    const sql = mockQuery.mock.calls[0][0]
    expect(sql).toContain('(quantity_on_hand - quantity_reserved) >= $2')
    expect(sql).not.toContain('version')
  })
})
