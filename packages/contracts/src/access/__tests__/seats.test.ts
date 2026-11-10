import { describe, expect, it } from 'vitest'
import { BranchSeatChangeInputSchema, BranchSeatListSchema, SeatChangeInputSchema, SeatUsageSchema } from '../index'

describe('seat contracts', () => {
  it('accepts a read-only toggle, a priority, or both, and nothing else', () => {
    expect(SeatChangeInputSchema.parse({ expected_version: 'u1-r1', read_only: true }).read_only).toBe(true)
    expect(SeatChangeInputSchema.parse({ expected_version: 'u1-r1', priority: 0 }).priority).toBe(0)
    expect(() => SeatChangeInputSchema.parse({ expected_version: 'u1-r1' })).toThrow()
    expect(() => SeatChangeInputSchema.parse({ expected_version: 'u1-r1', read_only: true, extra: 1 })).toThrow()
    expect(() => SeatChangeInputSchema.parse({ expected_version: 'u1-r1', priority: -1 })).toThrow()
    expect(() => SeatChangeInputSchema.parse({ read_only: true })).toThrow()
  })

  it('counts full seats and the read-only remainder', () => {
    expect(SeatUsageSchema.parse({ used: 3, limit: 3, read_only: 1 }).read_only).toBe(1)
    expect(() => SeatUsageSchema.parse({ used: 3, limit: 3 })).toThrow()
  })

  it('lists branches with their seat state', () => {
    const item = { id: 5, name: 'Jeddah', read_only: true, seat_choice: 'auto', restore_priority: 0 }
    expect(BranchSeatListSchema.parse({ items: [item], total: 1, limit: 0, read_only: 1 }).items[0]?.read_only).toBe(true)
    expect(() => BranchSeatListSchema.parse({ items: [{ ...item, seat_choice: 'x' }], total: 1, limit: null, read_only: 0 })).toThrow()
    expect(() => BranchSeatChangeInputSchema.parse({})).toThrow()
    expect(BranchSeatChangeInputSchema.parse({ read_only: false }).read_only).toBe(false)
  })
})
