import * as Vue from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// What is asserted is the request each hook makes and the reason-to-text mapping the TikTok screens share
// (the same recorder as the other inbox hook tests).
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

beforeEach(() => {
  seen.length = 0
  $api.mockClear()
  Object.values(queryClient).forEach(fn => fn.mockClear())
})

describe('TikTok refusal reasons', () => {
  it.each([
    'inbox_tiktok_unsupported_kind',
    'inbox_tiktok_reply_limit',
    'inbox_tiktok_auto_message_reviewing',
    'inbox_tiktok_auto_message_limit',
    'inbox_tiktok_auto_message_refused',
    'inbox_tiktok_sync_running',
    'inbox_channel_kind_unsupported',
  ])('translates the reason %s', (reason) => {
    expect(tiktok.inboxTikTokReasonKey(reason)).toBe(`inbox.tiktokErrors.${reason}`)
  })

  it('leaves the shared closed-window reason to the channel kind, not to TikTok', () => {
    expect(tiktok.inboxTikTokReasonKey('inbox_window_closed')).toBeNull()
  })

  it('translates nothing else, so an unknown refusal keeps the server text', () => {
    expect(tiktok.inboxTikTokReasonKey('some_new_reason')).toBeNull()
    expect(tiktok.inboxTikTokReasonKey('')).toBeNull()
    expect(tiktok.inboxTikTokReasonKey(null)).toBeNull()
    expect(tiktok.inboxTikTokReasonKey(undefined)).toBeNull()
  })

  it('reads details.reason off a refused call', () => {
    expect(tiktok.inboxTikTokErrorKey({ status: 422, details: { reason: 'inbox_tiktok_reply_limit' } })).toBe('inbox.tiktokErrors.inbox_tiktok_reply_limit')
    expect(tiktok.inboxTikTokErrorKey(new Error('boom'))).toBeNull()
    expect(tiktok.inboxTikTokErrorKey({ details: { reason: 7 } })).toBeNull()
  })
})
