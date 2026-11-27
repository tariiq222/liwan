import * as Vue from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../useApi'

// vue-query is replaced by a recorder of the options each hook passes, so what is asserted is the request the hook makes
// and the cache it refreshes.
type Options = { mutationFn?: (input: never) => unknown; onMutate?: () => unknown; onSuccess?: (data: unknown, variables?: unknown, context?: unknown) => unknown; onError?: (error: unknown) => unknown }
const seen: Options[] = []
const queries: Array<{ queryKey: unknown; enabled?: () => boolean; queryFn: (context: { signal?: undefined }) => Promise<unknown> }> = []
const queryClient = { invalidateQueries: vi.fn(async () => {}), setQueryData: vi.fn() }
vi.mock('@tanstack/vue-query', () => ({
  keepPreviousData: undefined,
  useQuery: (options: (typeof queries)[number]) => { queries.push(options); return {} },
  useMutation: (options: Options) => { seen.push(options); return {} },
  useInfiniteQuery: () => ({}),
  useQueryClient: () => queryClient,
}))
const $api = vi.fn(async (_path: string, _options?: unknown) => ({}))
vi.stubGlobal('useApi', () => ({ $api }))
vi.stubGlobal('computed', Vue.computed)
vi.stubGlobal('toValue', Vue.toValue)

const { usePatchInboxConversation, useSendInboxReply } = await import('../useInbox')

beforeEach(() => {
  seen.length = 0
  queries.length = 0
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

describe('refreshing after a reply', () => {
  it('refreshes the conversation the reply was sent for after the agent opened another one', async () => {
    const open = Vue.ref(7)
    useSendInboxReply(open)
    const options = seen.at(-1)!
    const sentTo = options.onMutate!()
    open.value = 8
    await options.onSuccess!({}, undefined, sentTo)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['inbox', 'messages', 7] })
    expect(queryClient.invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['inbox', 'messages', 8] })
  })
})

describe('agent availability', () => {
  it('patches one agent and reads the agents and the conversation lists again', async () => {
    const { useSetInboxAgentAvailability } = await import('../useInbox')
    useSetInboxAgentAvailability()
    const options = seen.at(-1)!
    await options.mutationFn!({ userId: 5, available: false } as never)
    expect($api).toHaveBeenCalledWith('/api/v1/inbox/agents/5', expect.objectContaining({ method: 'PATCH', body: { available: false } }))
    await options.onSuccess!({})
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['inbox', 'agents'] })
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['inbox', 'conversations'] })
  })

  it('saves a shift with PUT and keeps the saved ranges in the cache', async () => {
    const { useSaveInboxAgentShifts } = await import('../useInboxAgentShifts')
    useSaveInboxAgentShifts(5)
    const options = seen.at(-1)!
    await options.mutationFn!({ ranges: [] } as never)
    expect($api).toHaveBeenCalledWith('/api/v1/inbox/agents/5/shifts', expect.objectContaining({ method: 'PUT', body: { ranges: [] } }))
    await options.onSuccess!({ ranges: [] })
    expect(queryClient.setQueryData).toHaveBeenCalledWith(['inbox', 'agents', 'shifts', 5], { ranges: [] })
  })
})

describe('agent queries', () => {
  it('reads every page of the agents until the total is reached', async () => {
    const { useInboxAgents } = await import('../useInbox')
    const row = (id: number) => ({ id, name: `a${id}`, available: true, in_shift: true, effective_available: true })
    $api.mockImplementation(async (_path: string, options?: unknown) => {
      const offset = (options as { query: { offset: number } }).query.offset
      return { items: offset === 0 ? [row(1), row(2)] : [row(3)], total: 3 }
    })
    useInboxAgents()
    const result = await queries.at(-1)!.queryFn({}) as { items: unknown[] }
    expect(result.items).toHaveLength(3)
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/agents', expect.objectContaining({ query: { limit: 200, offset: 2 } }))
    $api.mockImplementation(async () => ({}))
  })

  it('narrows the agents by name on the server and keys the search apart from the full list', async () => {
    const { useInboxAgents } = await import('../useInbox')
    $api.mockImplementation(async () => ({ items: [], total: 0 }))
    useInboxAgents(true, ' سار ')
    expect(Vue.toValue(queries.at(-1)!.queryKey as never)).toEqual(['inbox', 'agents', 'search', 'سار'])
    await queries.at(-1)!.queryFn({})
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/agents', expect.objectContaining({ query: { limit: 200, offset: 0, q: 'سار' } }))
    useInboxAgents()
    expect(Vue.toValue(queries.at(-1)!.queryKey as never)).toEqual(['inbox', 'agents'])
    $api.mockImplementation(async () => ({}))
  })

  it.each([['canned replies', 'useInboxCannedReplies', '/api/v1/inbox/canned-replies'], ['tags', 'useInboxTags', '/api/v1/inbox/tags']] as const)('reads every page of the %s', async (_label, hook, path) => {
    const module = await import('../useInbox')
    $api.mockImplementation(async (_path: string, options?: unknown) => {
      const offset = (options as { query: { offset: number } }).query.offset
      return { items: offset === 0 ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }], total: 3 }
    })
    module[hook]()
    const result = await queries.at(-1)!.queryFn({}) as { items: unknown[] }
    expect(result.items).toHaveLength(3)
    expect($api).toHaveBeenLastCalledWith(path, expect.objectContaining({ query: { limit: 200, offset: 2 } }))
    $api.mockImplementation(async () => ({}))
  })

  it('gates useInboxCannedReplies via enabled', async () => {
    const { useInboxCannedReplies } = await import('../useInbox')
    const flag = Vue.ref(false)
    useInboxCannedReplies(flag)
    expect(Vue.toValue(queries.at(-1)!.enabled as never)).toBe(false)
    flag.value = true
    expect(Vue.toValue(queries.at(-1)!.enabled as never)).toBe(true)
    useInboxCannedReplies()
    expect(Vue.toValue(queries.at(-1)!.enabled as never)).toBe(true)
  })

  it('reads one agent by user id and stays off without the right or an id', async () => {
    const { useInboxAgent } = await import('../useInbox')
    useInboxAgent(() => 7, () => false)
    expect(queries.at(-1)!.enabled!()).toBe(false)
    useInboxAgent(() => undefined)
    expect(queries.at(-1)!.enabled!()).toBe(false)
    useInboxAgent(() => 7)
    expect(queries.at(-1)!.enabled!()).toBe(true)
    await queries.at(-1)!.queryFn({}).catch(() => {})
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/agents/7', expect.anything())
  })
})
