import { describe, expect, it } from 'vitest'
import { BranchCreateInputSchema, BranchCreatedSchema } from '../branch-create'

describe('branch creation contract', () => {
  it('accepts a trimmed name and nothing else', () => {
    expect(BranchCreateInputSchema.parse({ name: '  Riyadh ' })).toEqual({ name: 'Riyadh' })
    expect(BranchCreateInputSchema.safeParse({ name: '   ' }).success).toBe(false)
    expect(BranchCreateInputSchema.safeParse({ name: 'x'.repeat(201) }).success).toBe(false)
    expect(BranchCreateInputSchema.safeParse({ name: 'A', parent_id: 1 }).success).toBe(false)
  })
  it('returns the new company id and name', () => {
    expect(BranchCreatedSchema.parse({ id: 7, name: 'Riyadh' })).toEqual({ id: 7, name: 'Riyadh' })
    expect(BranchCreatedSchema.safeParse({ id: 0, name: 'Riyadh' }).success).toBe(false)
  })
})
