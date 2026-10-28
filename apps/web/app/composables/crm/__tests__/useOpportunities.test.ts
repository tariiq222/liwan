import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../useApi'
import { crmKeys } from '../crmKeys'

// A write on an opportunity that the server refuses with 409 (it was closed or changed meanwhile) must refresh the
// page's record and call log, so the actions of a closed record disappear.
const invalidate = vi.fn(async (_filters: unknown) => undefined)
const setQueryData = vi.fn()
const options: { mutationFn: (v: never) => Promise<unknown>; onError: (e: unknown, v: never) => Promise<void>; onSuccess: (r: unknown, v: never) => Promise<void> }[] = []
vi.mock('@tanstack/vue-query', () => ({
  useQuery: () => ({}),
  useInfiniteQuery: () => ({}),
  keepPreviousData: {},
  useQueryClient: () => ({ invalidateQueries: invalidate, setQueryData }),
  useMutation: (config: (typeof options)[number]) => { options.push(config); return config },
}))

const api = vi.fn()
const { useCrmOpportunityActions, nextCallOffset } = await import('../useOpportunities')

beforeEach(() => {
  options.length = 0
  invalidate.mockClear()
  api.mockReset()
  vi.stubGlobal('useApi', () => ({ $api: api }))
  vi.stubGlobal('useAccess', () => ({ can: () => true }))
})

const invalidatedKeys = () => invalidate.mock.calls.map(([filters]) => (filters as { queryKey: unknown }).queryKey)

describe('useCrmOpportunityActions', () => {
  it('refreshes the record and its calls after a 409, on every write', async () => {
    useCrmOpportunityActions()
    expect(options.length).toBeGreaterThanOrEqual(6)
    for (const config of options) {
      invalidate.mockClear()
      await config.onError(new ApiError(409, 'conflict', 'closed'), { id: 7, body: {} } as never)
      expect(invalidatedKeys()).toEqual([crmKeys.opportunity(7), crmKeys.calls(7)])
    }
  })

  it('leaves the cache alone after any other refusal', async () => {
    useCrmOpportunityActions()
    await options[0]!.onError(new ApiError(422, 'invalid', 'no', 'phone'), { id: 7, body: {} } as never)
    expect(invalidate).not.toHaveBeenCalled()
  })
})

describe('nextCallOffset', () => {
  const page = (count: number, total: number) => ({ items: Array.from({ length: count }, (_, index) => ({ id: index })), total }) as never

  it('asks for the next older page while calls remain', () => {
    expect(nextCallOffset([page(20, 45)])).toBe(20)
    expect(nextCallOffset([page(20, 45), page(20, 45)])).toBe(40)
  })

  it('stops when every call is loaded, or the server returns an empty page', () => {
    expect(nextCallOffset([])).toBeUndefined()
    expect(nextCallOffset([page(3, 3)])).toBeUndefined()
    expect(nextCallOffset([page(20, 45), page(20, 45), page(5, 45)])).toBeUndefined()
    expect(nextCallOffset([page(20, 45), page(0, 45)])).toBeUndefined()
  })
})
