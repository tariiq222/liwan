import * as Vue from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The TikTok channel page's own requests: the suggested questions and chat prompts, and the history import.
type Options = { queryKey?: unknown; enabled?: unknown; queryFn?: () => unknown; mutationFn?: (input: never) => unknown; onSuccess?: (data: unknown, input: unknown) => unknown }
const seen: Options[] = []
const queryClient = { invalidateQueries: vi.fn(async () => {}), setQueryData: vi.fn(), removeQueries: vi.fn() }
vi.mock('@tanstack/vue-query', () => ({
  keepPreviousData: undefined,
  useQuery: (options: Options) => { seen.push(options); return {} },
  useMutation: (options: Options) => { seen.push(options); return {} },
  useQueryClient: () => queryClient,
}))
const $api = vi.fn(async (_path: string, _options?: unknown): Promise<unknown> => ({}))
vi.stubGlobal('useApi', () => ({ $api }))
vi.stubGlobal('computed', Vue.computed)
vi.stubGlobal('toValue', Vue.toValue)

const tiktok = await import('../inboxTikTok')
const last = () => seen.at(-1)!

beforeEach(() => {
  seen.length = 0
  $api.mockClear()
  Object.values(queryClient).forEach(fn => fn.mockClear())
})

describe('shortcuts', () => {
  it('lists the channel items from its shortcuts route', async () => {
    tiktok.useInboxTikTokShortcuts(4)
    expect(Vue.toValue(last().queryKey as never)).toEqual(['inbox', 'tiktok-shortcuts', 4])
    await last().queryFn!()
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/channels/4/tiktok/shortcuts', expect.objectContaining({ schema: expect.anything() }))
  })

  it('creates an item and reloads the list', async () => {
    tiktok.useSaveInboxTikTokShortcut(4)
    await last().mutationFn!({ body: { kind: 'question', question: 'سؤال', answer: 'جواب' } } as never)
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/channels/4/tiktok/shortcuts', expect.objectContaining({
      method: 'POST', body: { kind: 'question', question: 'سؤال', answer: 'جواب' },
    }))
    await last().onSuccess!({}, {})
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['inbox', 'tiktok-shortcuts', 4] })
  })

  it('patches and deletes one item by its id', async () => {
    tiktok.useSaveInboxTikTokShortcut(4)
    await last().mutationFn!({ id: 9, body: { question: 'سؤال' } } as never)
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/channels/4/tiktok/shortcuts/9', expect.objectContaining({ method: 'PATCH', body: { question: 'سؤال' } }))
    tiktok.useDeleteInboxTikTokShortcut(4)
    await last().mutationFn!(9 as never)
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/channels/4/tiktok/shortcuts/9', expect.objectContaining({ method: 'DELETE' }))
    await last().onSuccess!({}, 9)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['inbox', 'tiktok-shortcuts', 4] })
  })

  it('switches a kind on or off and keeps the items the server recreated', async () => {
    tiktok.useEnableInboxTikTokShortcuts(4)
    const answer = { kind: 'question', enabled: true, items: [], total: 0 }
    await last().mutationFn!({ kind: 'question', enabled: true } as never)
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/channels/4/tiktok/shortcuts/enable', expect.objectContaining({ method: 'POST', body: { kind: 'question', enabled: true } }))
    await last().onSuccess!(answer, { kind: 'question', enabled: true })
    expect(queryClient.setQueryData).toHaveBeenCalledWith(['inbox', 'tiktok-shortcuts', 4], answer)
  })
})

describe('history import', () => {
  it('reads the latest job, null when the channel never imported', async () => {
    tiktok.useInboxTikTokSync(4)
    expect(Vue.toValue(last().queryKey as never)).toEqual(['inbox', 'tiktok-sync', 4])
    await last().queryFn!()
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/channels/4/tiktok/sync', expect.objectContaining({ schema: expect.anything() }))
  })

  it('starts one and stores the queued job', async () => {
    tiktok.useStartInboxTikTokSync(4)
    const job = { id: 12, state: 'queued', phase: 'single', conversations_count: 0, messages_count: 0, error: null, started_at: null, finished_at: null, created_at: '2026-11-05T09:00:00Z' }
    await last().mutationFn!({} as never)
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/channels/4/tiktok/sync', expect.objectContaining({ method: 'POST', schema: expect.anything() }))
    await last().onSuccess!(job, {})
    expect(queryClient.setQueryData).toHaveBeenCalledWith(['inbox', 'tiktok-sync', 4], { job })
  })
})
