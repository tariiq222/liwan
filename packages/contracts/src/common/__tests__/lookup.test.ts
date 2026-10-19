import { describe, expect, it } from 'vitest'
import { LookupListSchema } from '../lookup'

describe('LookupListSchema', () => {
  it('is the {items, total} envelope of id, name and code', () => {
    const list = { items: [{ id: 1, name: 'Saudi Arabia', code: 'SA' }], total: 1 }
    expect(LookupListSchema.parse(list)).toEqual(list)
    expect(LookupListSchema.safeParse({ items: [{ id: 1, name: 'x' }], total: 1 }).success).toBe(false)
    expect(LookupListSchema.safeParse({ items: [{ id: 1, name: 'x', code: 'X', flag: 'y' }], total: 1 }).success).toBe(false)
  })
})
