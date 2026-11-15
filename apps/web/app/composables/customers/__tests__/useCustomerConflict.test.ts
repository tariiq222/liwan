import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../useApi'
import { isCustomerAlreadyLinked } from '../customerErrors'
import { useCustomerConflict } from '../useCustomerConflict'

const candidates = [{ id: 7, name: 'منى العتيبي', phone_last4: '4567' }]
const conflict = () => new ApiError(409, 'conflict', 'x', undefined, { candidates })

describe('useCustomerConflict', () => {
  it('keeps the candidates of a conflict and repeats the stopped attempt with the choice', async () => {
    const flow = useCustomerConflict()
    const again = vi.fn(async () => 'done')
    expect(flow.offer(conflict(), again)).toBe(true)
    expect(flow.candidates.value).toEqual(candidates)
    await expect(flow.choose({ customer_id: 7 })).resolves.toBe('done')
    expect(again).toHaveBeenCalledWith({ customer_id: 7 })
    expect(flow.candidates.value).toBeNull()
  })

  it('takes a new customer as an answer too', async () => {
    const flow = useCustomerConflict()
    const again = vi.fn(async () => 'done')
    flow.offer(conflict(), again)
    await flow.choose({ create_new: true })
    expect(again).toHaveBeenCalledWith({ create_new: true })
  })

  it('refuses any other error, so the caller shows its message', () => {
    const flow = useCustomerConflict()
    expect(flow.offer(new ApiError(409, 'conflict', 'the opportunity is closed'), vi.fn())).toBe(false)
    expect(flow.offer(new ApiError(409, 'already_linked', 'x'), vi.fn())).toBe(false)
    expect(flow.candidates.value).toBeNull()
  })

  it('does nothing on a choice without an offer, and drops the offer on clear', async () => {
    const flow = useCustomerConflict()
    await expect(flow.choose({})).resolves.toBeUndefined()
    flow.offer(conflict(), vi.fn())
    flow.clear()
    expect(flow.candidates.value).toBeNull()
  })
})

describe('isCustomerAlreadyLinked', () => {
  it('is the 409 already_linked only', () => {
    expect(isCustomerAlreadyLinked(new ApiError(409, 'already_linked', 'x'))).toBe(true)
    expect(isCustomerAlreadyLinked(new ApiError(409, 'conflict', 'x'))).toBe(false)
    expect(isCustomerAlreadyLinked(new Error('x'))).toBe(false)
  })
})
