import * as Vue from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The hooks are run with the framework's auto-imports stubbed and vue-query replaced by a recorder of the options each
// hook passes, so what is asserted is the request each one makes and the cache each one refreshes.
type Options = { queryKey?: unknown; enabled?: unknown; queryFn?: () => unknown; mutationFn?: (input: never) => unknown; onSuccess?: (data: unknown, input: unknown) => unknown }
const seen: Options[] = []
const queryClient = { invalidateQueries: vi.fn(async () => {}), setQueryData: vi.fn(), removeQueries: vi.fn() }
vi.mock('@tanstack/vue-query', () => ({
  keepPreviousData: undefined,
  useInfiniteQuery: (options: Options) => { seen.push(options); return {} },
  useQuery: (options: Options) => { seen.push(options); return {} },
  useMutation: (options: Options) => { seen.push(options); return {} },
  useQueryClient: () => queryClient,
}))
vi.mock('../../../utils/attachmentFile', () => ({ fileToBase64: async () => 'aGVsbG8=' }))
const $api = vi.fn(async (_path: string, _options?: unknown) => ({}))
vi.stubGlobal('useApi', () => ({ $api }))
vi.stubGlobal('computed', Vue.computed)
vi.stubGlobal('toValue', Vue.toValue)

const { useDeleteInboxTemplate, useInboxChannelRef, useInboxChannelTemplates, useInboxTemplate, useSaveInboxTemplate, useUploadInboxTemplateSample } = await import('../useInboxSettings')
const { APPROVED_TEMPLATES_QUERY, inboxKeys, useInboxTemplates } = await import('../useInbox')
const last = () => seen.at(-1)!

beforeEach(() => {
  seen.length = 0
  $api.mockClear()
  Object.values(queryClient).forEach(fn => fn.mockClear())
})

describe('template queries', () => {
  it('lists a channel\'s templates with only the filters that are set', async () => {
    useInboxChannelTemplates(4, () => ({ status: 'approved', category: '', q: undefined, limit: 200 }))
    expect(Vue.toValue(last().enabled as never)).toBe(true)
    expect(Vue.toValue(last().queryKey as never)).toEqual(['inbox', 'templates', 4, { status: 'approved', limit: 200 }])
    await last().queryFn!()
    expect($api).toHaveBeenCalledWith('/api/v1/inbox/channels/4/templates', expect.objectContaining({ query: { status: 'approved', limit: 200 } }))
  })

  it('reads a channel\'s name through the template-manager route, under the inbox root the bus refreshes', async () => {
    useInboxChannelRef(4)
    expect(Vue.toValue(last().queryKey as never)).toEqual(['inbox', 'channel-ref', 4])
    await last().queryFn!()
    expect($api).toHaveBeenCalledWith('/api/v1/inbox/channels/4/ref', expect.anything())
    expect(inboxKeys.templates(4)[0]).toBe('inbox')
    expect(inboxKeys.template(12)[0]).toBe('inbox')
  })

  it('does not ask for a channel that is not valid', () => {
    useInboxChannelTemplates(null, () => ({}))
    expect(Vue.toValue(last().enabled as never)).toBe(false)
    useInboxTemplate(null)
    expect(Vue.toValue(last().enabled as never)).toBe(false)
    useInboxChannelRef(null)
    expect(Vue.toValue(last().enabled as never)).toBe(false)
  })

  it('reads one template by id', async () => {
    useInboxTemplate(7)
    expect(Vue.toValue(last().queryKey as never)).toEqual(inboxKeys.template(7))
    await last().queryFn!()
    expect($api).toHaveBeenCalledWith('/api/v1/inbox/templates/7', expect.anything())
  })

  it('asks the composer for approved templates only, in one page', async () => {
    useInboxTemplates(4, true)
    await last().queryFn!()
    expect($api).toHaveBeenCalledWith('/api/v1/inbox/channels/4/templates', expect.objectContaining({ query: APPROVED_TEMPLATES_QUERY }))
    expect(APPROVED_TEMPLATES_QUERY).toEqual({ status: 'approved', limit: 200 })
  })
})

describe('template mutations', () => {
  const body = { name: 'a' } as never

  it('creates on the channel and edits by id, then caches the answer and refreshes the channel\'s lists', async () => {
    useSaveInboxTemplate(4)
    const options = last()
    await options.mutationFn!({ body } as never)
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/channels/4/templates', expect.objectContaining({ method: 'POST', body }))
    await options.mutationFn!({ id: 9, body } as never)
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/templates/9', expect.objectContaining({ method: 'PATCH', body }))
    await options.onSuccess!({ id: 9 }, {})
    expect(queryClient.setQueryData).toHaveBeenCalledWith(inboxKeys.template(9), { id: 9 })
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: inboxKeys.templates(4) })
  })

  it('deletes by id and forgets the template', async () => {
    useDeleteInboxTemplate(4)
    await last().mutationFn!(9 as never)
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/templates/9', { method: 'DELETE' })
    await last().onSuccess!(undefined, 9)
    expect(queryClient.removeQueries).toHaveBeenCalledWith({ queryKey: inboxKeys.template(9) })
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: inboxKeys.templates(4) })
  })

  it('uploads the sample file of a header as base64 JSON to the channel', async () => {
    useUploadInboxTemplateSample(4)
    const file = { name: 'a.png', type: 'image/png' }
    await last().mutationFn!(file as never)
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/channels/4/templates/uploads', expect.objectContaining({ method: 'POST', body: { name: 'a.png', mimetype: 'image/png', data: 'aGVsbG8=' } }))
  })
})
