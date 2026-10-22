import { describe, expect, it } from 'vitest'
import { BranchPolicyInputSchema, BranchPolicySchema, UserBranchAccessInputSchema, UserBranchAccessSchema } from '../branches'

describe('branch authorization contracts', () => {
  it('accepts inactive saved inheritance and exact versioned shapes', () => {
    expect(BranchPolicyInputSchema.parse({ expected_version: 'b1-v2', mode: 'delegated',
      branches: [{ id: 2, inherit: false, role_ids: [3] }] }).branches[0]?.role_ids).toEqual([3])
    expect(BranchPolicySchema.safeParse({ version: 'b1-v2', mode: 'delegated', branches: [], roles: [] }).success).toBe(true)
    expect(UserBranchAccessSchema.safeParse({ version: 'b1-v2-u1-r3', branches: [], roles: [
      { id: 3, key: 'custom_reader', name: { ar: 'قراءة', en: null }, company_id: 2 },
    ] }).success).toBe(true)
  })
  it('rejects duplicate ids, injected fields and invalid scalar types', () => {
    const branch = { id: 2, role_ids: [3] }
    expect(UserBranchAccessInputSchema.safeParse({ expected_version: 'v1', branches: [branch, branch] }).success).toBe(false)
    expect(UserBranchAccessInputSchema.safeParse({ expected_version: 'v1', branches: [{ ...branch, role_ids: [3, 3] }] }).success).toBe(false)
    expect(BranchPolicyInputSchema.safeParse({ expected_version: '', mode: 'delegated', branches: [] }).success).toBe(false)
    expect(BranchPolicyInputSchema.safeParse({ expected_version: 'v1', mode: 'delegated', branches: [], company_id: 9 }).success).toBe(false)
    expect(UserBranchAccessInputSchema.safeParse({ expected_version: 'v1', branches: [{ id: true, role_ids: [] }] }).success).toBe(false)
  })
})
