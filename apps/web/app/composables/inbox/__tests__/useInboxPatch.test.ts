import * as Vue from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../useApi'

// vue-query is replaced by a recorder of the options each hook passes, so what is asserted is the request the hook makes
// and the cache it refreshes.
type Options = { mutationFn?: (input: never) => unknown; onSuccess?: (data: unknown) => unknown; onError?: (error: unknown) => unknown }
const seen: Options[] = []
const queryClient = { invalidateQueries: vi.fn(async () => {}), setQueryData: vi.fn() }
vi.mock('@tanstack/vue-query', () => ({
  keepPreviousData: undefined,
  useQuery: () => ({}),
  useMutation: (options: Options) => { seen.push(options); return {} },
  useInfiniteQuery: () => ({}),
  useQueryClient: () => queryClient,
}))
const $api = vi.fn(async (_path: string, _options?: unknown) => ({}))
vi.stubGlobal('useApi', () => ({ $api }))
vi.stubGlobal('computed', Vue.computed)
vi.stubGlobal('toValue', Vue.toValue)

const { usePatchInboxConversation } = await import('../useInbox')

beforeEach(() => {
  seen.length = 0
  $api.mockClear()
  Object.values(queryClient).forEach(fn => fn.mockClear())
})

describe('patching a conversation', () => {
  it('sends the revision the user saw and reads the detail again when someone changed it first', async () => {
    usePatchInboxConversation(7)
    const options = seen.at(-1)!
    await options.mutationFn!({ revision: 4, priority: 'high' } as never)
    expect($api).toHaveBeenCalledWith('/api/v1/inbox/conversations/7', expect.objectContaining({ method: 'PATCH', body: { revision: 4, priority: 'high' } }))

    await options.onError!(new ApiError(409, 'stale_write', 'stale', 'revision'))
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['inbox', 'conversation', 7] })
  })

  it('leaves the cache alone when the refusal is not a stale write', async () => {
    usePatchInboxConversation(7)
    await seen.at(-1)!.onError!(new ApiError(403, 'forbidden', 'no'))
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled()
  })
})
