import { ref, toValue } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hrLeaveRequestQuery, useCancellationDecision, useHrLeaveApproval, useHrLeaveTypes, useLeaveDecision, useWithdrawLeaveRequest } from '../useHrLeave'
const mocks = vi.hoisted(() => ({ api: vi.fn(), invalidate: vi.fn() }))
vi.mock('@tanstack/vue-query', () => ({ useQuery: (options: unknown) => options, useMutation: (options: unknown) => options, useQueryClient: () => ({ invalidateQueries: mocks.invalidate }) }))
vi.mock('../useHrOwnIdentity', () => ({ useHrOwnIdentity: () => ({ ready: ref(true), scope: ref('own') }) }))
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })
describe('leave cancellation query and decisions', () => {
  it('does not combine a pending cancellation queue with initial approval state filters', () => {
    const query = hrLeaveRequestQuery({ scope: 'pending', limit: 25, offset: 0, cancellation_state: 'pending' })
    expect(query.cancellation_state).toBe('pending')
    expect(query.state).toBeUndefined()
  })
  it('sends the aggregate revision and invalidates all leave reads after confirmed success', async () => {
    vi.stubGlobal('useApi', () => ({ $api: mocks.api }))
    const mutation = useCancellationDecision() as unknown as {mutationFn:(body: unknown) => Promise<unknown>,onSuccess:()=>Promise<unknown>}
    await mutation.mutationFn({ id: 7, decision: 'refuse', revision: 3, reason: 'Staff shortage' })
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/hr/leave/requests/7/cancellation/refuse', expect.objectContaining({body:{revision:3,reason:'Staff shortage'}}))
    await mutation.onSuccess()
    expect(mocks.invalidate).toHaveBeenCalledWith({queryKey:['hr','leave']})
  })
  it('marks the caller\'s own leave so the server acts in the home company, and leaves staff calls unmarked', async () => {
    vi.stubGlobal('useApi', () => ({ $api: mocks.api }))
    const withdraw = useWithdrawLeaveRequest() as unknown as { mutationFn: (body: unknown) => Promise<unknown> }
    await withdraw.mutationFn({ id: 7, mine: true })
    expect(mocks.api).toHaveBeenLastCalledWith('/api/v1/hr/leave/requests/7/cancel', expect.objectContaining({ query: { mine: '1' } }))
    await withdraw.mutationFn({ id: 7, mine: false })
    expect(mocks.api).toHaveBeenLastCalledWith('/api/v1/hr/leave/requests/7/cancel', expect.objectContaining({ query: undefined }))
    const decide = useLeaveDecision() as unknown as { mutationFn: (body: unknown) => Promise<unknown> }
    await decide.mutationFn({ id: 7, decision: 'cancel', mine: true })
    expect(mocks.api).toHaveBeenLastCalledWith('/api/v1/hr/leave/requests/7/cancel', expect.objectContaining({ query: { mine: '1' } }))
    await decide.mutationFn({ id: 7, decision: 'approve', mine: true })
    expect(mocks.api).toHaveBeenLastCalledWith('/api/v1/hr/leave/requests/7/approve', expect.objectContaining({ query: undefined }))
  })
  it('lists the home company\'s leave types only for the caller\'s own request', async () => {
    vi.stubGlobal('useApi', () => ({ $api: mocks.api }))
    const own = useHrLeaveTypes({ mine: true }) as unknown as { queryKey: { value: unknown[] }, queryFn: () => Promise<unknown> }
    await own.queryFn()
    expect(mocks.api).toHaveBeenLastCalledWith('/api/v1/hr/leave/types', expect.objectContaining({ query: { mine: '1' } }))
    expect(own.queryKey.value).toContain('mine')
    const staff = useHrLeaveTypes() as unknown as { queryKey: { value: unknown[] }, queryFn: () => Promise<unknown> }
    await staff.queryFn()
    expect(mocks.api).toHaveBeenLastCalledWith('/api/v1/hr/leave/types', expect.objectContaining({ query: { mine: undefined } }))
  })
  it('reads the approval status of the caller\'s own leave with the marker and keeps its cache entry apart from the staff view', async () => {
    vi.stubGlobal('useApi', () => ({ $api: mocks.api }))
    const own = useHrLeaveApproval(7, true) as unknown as { queryKey: { value: unknown[] }, queryFn: () => Promise<unknown> }
    await own.queryFn()
    expect(mocks.api).toHaveBeenLastCalledWith('/api/v1/hr/leave/requests/7/approval', expect.objectContaining({ query: { mine: '1' } }))
    const staff = useHrLeaveApproval(7) as unknown as { queryKey: { value: unknown[] }, queryFn: () => Promise<unknown> }
    await staff.queryFn()
    expect(mocks.api).toHaveBeenLastCalledWith('/api/v1/hr/leave/requests/7/approval', expect.objectContaining({ query: undefined }))
    expect(own.queryKey.value).not.toEqual(staff.queryKey.value)
  })
})
