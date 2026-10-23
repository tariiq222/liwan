import { ref, toValue } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hrLeaveRequestQuery, useCancellationDecision } from '../useHrLeave'
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
})
