import * as Vue from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// vue-query is replaced by a recorder of the options each hook passes, so what is asserted is the request each hook
// makes and the cache each one refreshes.
type Options = { queryKey?: unknown; enabled?: unknown; queryFn?: () => unknown; mutationFn?: (input: never) => unknown; onSuccess?: (data: unknown, input: unknown) => unknown; onSettled?: () => unknown }
const seen: Options[] = []
const queryClient = { invalidateQueries: vi.fn(async () => {}), setQueryData: vi.fn(), removeQueries: vi.fn() }
vi.mock('@tanstack/vue-query', () => ({
  keepPreviousData: undefined,
  useQuery: (options: Options) => { seen.push(options); return {} },
  useMutation: (options: Options) => { seen.push(options); return {} },
  useQueryClient: () => queryClient,
}))
const $api = vi.fn(async (_path: string, _options?: unknown) => ({}))
vi.stubGlobal('useApi', () => ({ $api }))
vi.stubGlobal('computed', Vue.computed)
vi.stubGlobal('toValue', Vue.toValue)

const flows = await import('../useInboxFlows')
const last = () => seen.at(-1)!
const key = () => Vue.toValue(last().queryKey as never)

beforeEach(() => {
  seen.length = 0
  $api.mockClear()
  Object.values(queryClient).forEach(fn => fn.mockClear())
})

describe('form queries', () => {
  it('lists a channel\'s forms with only the filters that are set, under the inbox root', async () => {
    flows.useInboxChannelFlows(4, () => ({ status: 'draft', q: '', sendable: false, limit: 200 }))
    expect(key()).toEqual(['inbox', 'flows', 'channel', 4, { status: 'draft', limit: 200 }])
    await last().queryFn!()
    expect($api).toHaveBeenCalledWith('/api/v1/inbox/channels/4/flows', expect.objectContaining({ query: { status: 'draft', limit: 200 } }))
  })

  it('asks the pickers for sendable forms only, in one page, and not without a channel', async () => {
    flows.useInboxSendableFlows(4)
    await last().queryFn!()
    expect($api).toHaveBeenCalledWith('/api/v1/inbox/channels/4/flows', expect.objectContaining({ query: { sendable: true, limit: 200 } }))
    expect(Vue.toValue(last().enabled as never)).toBe(true)
    flows.useInboxSendableFlows(null)
    expect(Vue.toValue(last().enabled as never)).toBe(false)
    flows.useInboxSendableFlows(4, false)
    expect(Vue.toValue(last().enabled as never)).toBe(false)
  })

  it('reads one form, its answers with the date filter, and a conversation\'s answers', async () => {
    flows.useInboxFlow(7)
    await last().queryFn!()
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/flows/7', expect.anything())
    flows.useInboxFlow(null)
    expect(Vue.toValue(last().enabled as never)).toBe(false)
    flows.useInboxFlowSubmissions(7, () => ({ date_from: '2026-11-01', date_to: undefined, limit: 25, offset: 25 }))
    await last().queryFn!()
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/flows/7/submissions', expect.objectContaining({ query: { date_from: '2026-11-01', limit: 25, offset: 25 } }))
    flows.useInboxConversationFlowSubmissions(12)
    await last().queryFn!()
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/conversations/12/flow-submissions', expect.anything())
    expect(flows.inboxFlowKeys.conversation(12)[0]).toBe('inbox')
  })
})

describe('form mutations', () => {
  const flow = { id: 9, channel: { id: 4 } }

  it('creates on the channel without an id and replaces the draft with one', async () => {
    flows.useSaveInboxFlow(4)
    const body = { name: 'x' } as never
    await last().mutationFn!({ body } as never)
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/channels/4/flows', expect.objectContaining({ method: 'POST', body }))
    await last().mutationFn!({ id: 9, body } as never)
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/flows/9', expect.objectContaining({ method: 'PATCH', body }))
  })

  it('caches the stored form and reloads the channel\'s lists after every write', async () => {
    flows.useSaveInboxFlow(4)
    await last().onSuccess!(flow, {})
    expect(queryClient.setQueryData).toHaveBeenCalledWith(flows.inboxFlowKeys.flow(9), flow)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: flows.inboxFlowKeys.channel(4) })
  })

  it.each([
    ['usePublishInboxFlow', 'publish'],
    ['useDeprecateInboxFlow', 'deprecate'],
  ] as const)('%s posts to the form\'s %s route', async (hook, action) => {
    flows[hook]()
    await last().mutationFn!(9 as never)
    expect($api).toHaveBeenLastCalledWith(`/api/v1/inbox/flows/${9}/${action}`, expect.objectContaining({ method: 'POST' }))
  })

  it('copies with the name and the replace choice', async () => {
    flows.useCopyInboxFlow()
    await last().mutationFn!({ id: 9, body: { name: 'نسخة', replace: true } } as never)
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/flows/9/copy', expect.objectContaining({ method: 'POST', body: { name: 'نسخة', replace: true } }))
  })

  it('deletes a draft and forgets it', async () => {
    flows.useDeleteInboxFlow(4)
    await last().mutationFn!(9 as never)
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/flows/9', { method: 'DELETE' })
    await last().onSuccess!(undefined, 9)
    expect(queryClient.removeQueries).toHaveBeenCalledWith({ queryKey: flows.inboxFlowKeys.flow(9) })
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: flows.inboxFlowKeys.channel(4) })
  })

  it('syncs with Meta and reloads every form, even when the sync fails', async () => {
    flows.useSyncInboxFlows(4)
    await last().mutationFn!(undefined as never)
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/channels/4/flows/sync', expect.objectContaining({ method: 'POST' }))
    await last().onSettled!()
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: flows.inboxFlowKeys.all })
  })

  it('fetches Meta\'s preview link on demand', async () => {
    flows.useInboxFlowPreviewLink()
    await last().mutationFn!(9 as never)
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/flows/9/preview', expect.anything())
  })
})
