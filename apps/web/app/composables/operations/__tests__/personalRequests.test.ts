import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { operationRequestQueryOptions, operationRequestListParams } from '../useOperations'

describe('employee request boundary', () => {
  it('forces own employee purpose in the personal surface while keeping reviewers able to review both purposes', () => {
    expect(operationRequestListParams('monitoring', true)).toEqual({ scope: 'mine', purpose: 'employee' })
    expect(operationRequestListParams('mine', false)).toEqual({ scope: 'mine', purpose: 'work' })
    expect(operationRequestListParams('pending', false)).toEqual({ scope: 'pending' })
  })
  it('applies the selected request type only to the shared review and monitoring lists', () => {
    expect(operationRequestListParams('pending', false, 'employee')).toEqual({ scope: 'pending', purpose: 'employee' })
    expect(operationRequestListParams('monitoring', false, 'work')).toEqual({ scope: 'monitoring', purpose: 'work' })
    expect(operationRequestListParams('mine', false, 'employee')).toEqual({ scope: 'mine', purpose: 'work' })
    expect(operationRequestListParams('pending', true, 'work')).toEqual({ scope: 'mine', purpose: 'employee' })
  })
  it('uses the strict own detail endpoint and isolates its cache by identity and company', async () => {
    const api = vi.fn().mockResolvedValue({ id: 9 })
    const identity = ref({ id: 7, company: { id: 1 } })
    const options = operationRequestQueryOptions(api, ref(9), true, identity)
    await options.queryFn()
    expect(api).toHaveBeenCalledWith('/api/v1/operations/requests/employee/me/9', expect.anything())
    const before = options.queryKey.value
    identity.value = { id: 7, company: { id: 2 } }
    expect(options.queryKey.value).not.toEqual(before)
    expect(options.queryKey.value).not.toEqual(operationRequestQueryOptions(api, ref(9), false, identity).queryKey.value)
  })
})
