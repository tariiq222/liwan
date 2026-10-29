import * as Vue from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Options = {
  queryKey?: unknown; enabled?: unknown; refetchInterval?: unknown; queryFn?: () => unknown; mutationFn?: (input: never) => unknown
  onSuccess?: (data: unknown, input: unknown) => unknown
}
const seen: Options[] = []
const queryClient = { invalidateQueries: vi.fn(async () => {}), setQueryData: vi.fn(), removeQueries: vi.fn() }
vi.mock('@tanstack/vue-query', () => ({
  useQuery: (options: Options) => { seen.push(options); return {} },
  useMutation: (options: Options) => { seen.push(options); return {} },
  useQueryClient: () => queryClient,
  keepPreviousData: 'keep',
}))
vi.mock('../../../utils/attachmentFile', () => ({ fileToBase64: async () => 'QUJD' }))
vi.mock('@/modules/registry', () => ({ hasFeature: () => true }))
const $api = vi.fn(async (_path: string, _options?: unknown): Promise<unknown> => ({}))
vi.stubGlobal('useApi', () => ({ $api }))
vi.stubGlobal('useMe', () => ({ me: Vue.ref({}) }))
vi.stubGlobal('computed', Vue.computed)
vi.stubGlobal('toValue', Vue.toValue)

const hooks = await import('../useInboxCampaigns')
const last = () => seen.at(-1)!
const query = (state: string | undefined) => ({ state: { data: state ? { state } : undefined } })

beforeEach(() => {
  seen.length = 0
  $api.mockClear()
  Object.values(queryClient).forEach(fn => fn.mockClear())
})

describe('campaign queries', () => {
  it('keeps every key under the inbox root so the bus invalidation refreshes them', () => {
    hooks.useInboxCampaign(4)
    hooks.useInboxAudience(2)
    hooks.useInboxChannelSending(1)
    hooks.useInboxContactMarketing(9)
    hooks.useInboxCampaignSettings()
    for (const entry of seen) expect(Vue.toValue(entry.queryKey as never) as unknown[]).toSatisfy((key: unknown[]) => key[0] === 'inbox')
  })

  it('refetches a campaign every ten seconds only while it is scheduled or running', () => {
    hooks.useInboxCampaign(4)
    const interval = last().refetchInterval as (q: unknown) => number | false
    expect(interval(query('running'))).toBe(10_000)
    expect(interval(query('scheduled'))).toBe(10_000)
    expect(interval(query('paused'))).toBe(false)
    expect(interval(query('done'))).toBe(false)
    expect(interval(query(undefined))).toBe(false)
  })

  it('polls the recipients only when the page asks for it', () => {
    const poll = Vue.ref(false)
    hooks.useInboxCampaignRecipients(4, { state: '', failure: '', q: '', offset: 0 }, poll)
    const interval = last().refetchInterval as () => number | false
    expect(interval()).toBe(false)
    poll.value = true
    expect(interval()).toBe(10_000)
  })

  it('lists campaigns with the URL filters and the page window', async () => {
    hooks.useInboxCampaignList({ state: 'running', channelId: 2, q: 'ش', offset: 20 })
    await last().queryFn!()
    expect($api).toHaveBeenCalledWith('/api/v1/inbox/campaigns', expect.objectContaining({ query: { state: 'running', channel_id: 2, q: 'ش', limit: 20, offset: 20 } }))
  })

  it('does not ask for a preview before a template is chosen', () => {
    hooks.useInboxCampaignPreview(null)
    expect(Vue.toValue(last().enabled as never)).toBe(false)
  })

  it('reads the campaign channels from the automation channel list a campaigns manager may open', async () => {
    hooks.useInboxCampaignChannels()
    await last().queryFn!()
    expect($api).toHaveBeenCalledWith('/api/v1/inbox/automation/channels', expect.anything())
  })
})

describe('campaign mutations', () => {
  it('creates with POST and edits with PATCH, putting the answer in the cache', async () => {
    hooks.useSaveInboxCampaign()
    await last().mutationFn!({ body: { name: 'x' } } as never)
    expect($api).toHaveBeenCalledWith('/api/v1/inbox/campaigns', expect.objectContaining({ method: 'POST' }))
    await last().mutationFn!({ id: 4, body: { name: 'y' } } as never)
    expect($api).toHaveBeenCalledWith('/api/v1/inbox/campaigns/4', expect.objectContaining({ method: 'PATCH', body: { name: 'y' } }))
    await last().onSuccess!({ id: 4 }, {})
    expect(queryClient.setQueryData).toHaveBeenCalledWith(['inbox', 'campaigns', 'detail', 4], { id: 4 })
  })

  it.each(['launch', 'pause', 'resume', 'cancel', 'retry'] as const)('%s posts to its own route and replaces the cached campaign', async (action) => {
    hooks.useInboxCampaignAction(4)
    await last().mutationFn!(action as never)
    expect($api).toHaveBeenCalledWith(`/api/v1/inbox/campaigns/${action}`.replace('campaigns/', 'campaigns/4/'), expect.objectContaining({ method: 'POST' }))
    await last().onSuccess!({ id: 4 }, action)
    expect(queryClient.setQueryData).toHaveBeenCalledWith(['inbox', 'campaigns', 'detail', 4], { id: 4 })
  })

  it('sends a test to one contact', async () => {
    hooks.useTestInboxCampaign(4)
    await last().mutationFn!(7 as never)
    expect($api).toHaveBeenCalledWith('/api/v1/inbox/campaigns/4/test', expect.objectContaining({ method: 'POST', body: { contact_id: 7 } }))
  })

  it('uploads the header file as base64 JSON', async () => {
    hooks.useUploadInboxCampaignHeader()
    await last().mutationFn!({ name: 'a.jpg', type: 'image/jpeg' } as never)
    expect($api).toHaveBeenCalledWith('/api/v1/inbox/campaigns/uploads', expect.objectContaining({ method: 'POST', body: { name: 'a.jpg', mimetype: 'image/jpeg', data: 'QUJD' } }))
  })

  it('imports the contacts CSV and reloads the audience counts', async () => {
    hooks.useImportInboxContacts()
    const body = { name: 'c.csv', data: 'QUJD', tag_ids: [], consent: 'unknown' }
    await last().mutationFn!(body as never)
    expect($api).toHaveBeenCalledWith('/api/v1/inbox/contacts/import', expect.objectContaining({ method: 'POST', body }))
    await last().onSuccess!({}, body)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['inbox', 'audiences'] })
  })

  it('patches the sending API and refreshes from Meta', async () => {
    hooks.usePatchInboxChannelSending(3)
    await last().mutationFn!({ marketing_api: 'marketing_messages' } as never)
    expect($api).toHaveBeenCalledWith('/api/v1/inbox/channels/3/sending', expect.objectContaining({ method: 'PATCH' }))
    hooks.useRefreshInboxChannelSending(3)
    await last().mutationFn!(undefined as never)
    expect($api).toHaveBeenCalledWith('/api/v1/inbox/channels/3/sending/refresh', expect.objectContaining({ method: 'POST' }))
  })

  it('patches a contact\'s consent and tags', async () => {
    hooks.usePatchInboxContactMarketing(9)
    await last().mutationFn!({ tag_ids: [1] } as never)
    expect($api).toHaveBeenCalledWith('/api/v1/inbox/contacts/9/marketing', expect.objectContaining({ method: 'PATCH', body: { tag_ids: [1] } }))
  })
})
