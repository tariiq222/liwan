import * as Vue from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Options = { queryKey?: unknown; enabled?: unknown; gcTime?: number; queryFn?: () => unknown; mutationFn?: (input: never) => unknown; onSuccess?: (data: unknown, input: unknown) => unknown }
const seen: Options[] = []
const queryClient = { invalidateQueries: vi.fn(async () => {}), setQueryData: vi.fn() }
vi.mock('@tanstack/vue-query', () => ({
  useQuery: (options: Options) => { seen.push(options); return {} },
  useMutation: (options: Options) => { seen.push(options); return {} },
  useQueryClient: () => queryClient,
}))
vi.mock('../../../utils/attachmentFile', () => ({ fileToBase64: async () => 'QUJD' }))
const $api = vi.fn(async (_path: string, _options?: unknown): Promise<unknown> => ({}))
vi.stubGlobal('useApi', () => ({ $api }))
vi.stubGlobal('computed', Vue.computed)
vi.stubGlobal('toValue', Vue.toValue)

const hooks = await import('../useInboxChannelHealth')
const { inboxSettingsKeys } = await import('../useInboxSettings')
const last = () => seen.at(-1)!

beforeEach(() => {
  seen.length = 0
  $api.mockClear()
  Object.values(queryClient).forEach(fn => fn.mockClear())
})

describe('channel health queries', () => {
  it('pages the alerts by offset under the inbox root', async () => {
    hooks.useInboxChannelAlerts(4, 20)
    expect(Vue.toValue(last().queryKey as never)).toEqual(['inbox', 'channel', 4, 'alerts', 20])
    await last().queryFn!()
    expect($api).toHaveBeenCalledWith('/api/v1/inbox/channels/4/alerts', expect.objectContaining({ query: { limit: hooks.INBOX_ALERT_PAGE, offset: 20 } }))
  })

  it('reads the profile live and never keeps it, under a root the inbox bus does not invalidate', async () => {
    hooks.useInboxBusinessProfile(4)
    expect(Vue.toValue(last().queryKey as never)).toEqual(['inbox-profile', 4])
    expect(last().gcTime).toBe(0)
    await last().queryFn!()
    expect($api).toHaveBeenCalledWith('/api/v1/inbox/channels/4/profile', expect.objectContaining({ schema: expect.anything() }))
    hooks.useInboxBusinessProfile(null)
    expect(Vue.toValue(last().enabled as never)).toBe(false)
  })
})

describe('channel health mutations', () => {
  it('patches the profile and puts the answer in the cache', async () => {
    hooks.useSaveInboxBusinessProfile(4)
    await last().mutationFn!({ about: 'x' } as never)
    expect($api).toHaveBeenCalledWith('/api/v1/inbox/channels/4/profile', expect.objectContaining({ method: 'PATCH', body: { about: 'x' } }))
    last().onSuccess!({ about: 'x' }, {})
    expect(queryClient.setQueryData).toHaveBeenCalledWith(['inbox-profile', 4], { about: 'x' })
  })

  it('uploads the picture as base64 JSON with its type', async () => {
    hooks.useUploadInboxProfilePicture(4)
    await last().mutationFn!({ name: 'logo.png', type: 'image/png' } as never)
    expect($api).toHaveBeenCalledWith('/api/v1/inbox/channels/4/profile/picture', expect.objectContaining({ method: 'PUT', body: { name: 'logo.png', mimetype: 'image/png', data: 'QUJD' } }))
  })

  it.each([
    ['useRequestInboxDisplayName', 'display-name', { name: 'عيادة' }],
    ['useRegisterInboxNumber', 'register', { pin: '123456' }],
    ['useEnableInboxTemplateInsights', 'template-insights', {}],
    ['useSyncInboxAnalytics', 'analytics/sync', {}],
  ] as const)('%s posts to %s and refreshes the channel and its timeline', async (hook, path, body) => {
    hooks[hook](4)
    await last().mutationFn!(body as never)
    expect($api).toHaveBeenCalledWith(`/api/v1/inbox/channels/4/${path}`, expect.objectContaining({ method: 'POST', body, schema: expect.anything() }))
    const channel = { id: 4 }
    await last().onSuccess!(channel, body)
    expect(queryClient.setQueryData).toHaveBeenCalledWith(inboxSettingsKeys.channel(4), channel)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: hooks.inboxHealthKeys.alertsOf(4) })
  })

  it('sends the PIN once and expects no body back', async () => {
    hooks.useSetInboxTwoStepPin(4)
    await last().mutationFn!({ pin: '123456' } as never)
    const [, options] = $api.mock.calls.at(-1)!
    expect(options).toEqual({ method: 'POST', body: { pin: '123456' } })
    await last().onSuccess!(undefined, {})
    expect(queryClient.setQueryData).not.toHaveBeenCalled()
  })
})
