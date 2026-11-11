import * as Vue from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// vue-query is replaced by a recorder of the options each hook passes. The bus is the real module, so the interval
// follows the real connection signal: polling while the socket is down, silence while pushes arrive.
type Options = { queryKey: unknown; refetchInterval?: Vue.Ref<number | false> }
const seen: Options[] = []
vi.mock('@tanstack/vue-query', () => ({
  keepPreviousData: undefined,
  useQuery: (options: Options) => { seen.push(options); return {} },
  useInfiniteQuery: (options: Options) => { seen.push(options); return { data: Vue.ref(undefined) } },
  useMutation: () => ({}),
  useQueryClient: () => ({}),
}))
vi.stubGlobal('useApi', () => ({ $api: vi.fn() }))
vi.stubGlobal('computed', Vue.computed)
vi.stubGlobal('toValue', Vue.toValue)

const { BUS_FALLBACK_POLL_MS, useBus } = await import('../../useBus')
const { inboxKeys, useInboxConversation, useInboxConversations, useInboxMessages } = await import('../useInbox')
const route = { status: 'open', offset: 0 } as never

beforeEach(() => { seen.length = 0 })

describe('inbox polling fallback', () => {
  it.each([
    ['the conversation list', () => useInboxConversations(route)],
    ['the open conversation', () => useInboxConversation(7)],
    ['the open conversation messages', () => useInboxMessages(7)],
  ])('%s polls only while the bus is disconnected', (_name, hook) => {
    const { connected } = useBus()
    connected.value = false
    hook()
    const interval = seen.at(-1)!.refetchInterval!
    expect(interval.value).toBe(BUS_FALLBACK_POLL_MS)
    connected.value = true
    expect(interval.value).toBe(false)
    connected.value = false
    expect(interval.value).toBe(BUS_FALLBACK_POLL_MS)
  })

  it('keeps the query keys unchanged', () => {
    useInboxMessages(7)
    expect(Vue.toValue(seen.at(-1)!.queryKey)).toEqual(inboxKeys.messagesOf(7))
  })
})
