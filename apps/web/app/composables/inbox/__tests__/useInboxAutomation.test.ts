import * as Vue from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Same recorder as the template query tests: what is asserted is the request each hook makes and the cache it refreshes.
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

const hooks = await import('../useInboxAutomation')
const last = () => seen.at(-1)!

beforeEach(() => {
  seen.length = 0
  $api.mockClear()
  Object.values(queryClient).forEach(fn => fn.mockClear())
})

const HOURS = { timezone: 'Asia/Riyadh', days: [], holidays: [] }

describe('working hours hooks', () => {
  it('reads and writes the company hours with PUT and keeps the answer in the cache', async () => {
    hooks.useInboxWorkingHours()
    await last().queryFn!()
    expect($api).toHaveBeenCalledWith('/api/v1/inbox/working-hours', expect.objectContaining({ schema: expect.anything() }))
    hooks.useSaveInboxWorkingHours()
    await last().mutationFn!(HOURS as never)
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/working-hours', expect.objectContaining({ method: 'PUT', body: HOURS }))
    last().onSuccess!(HOURS, HOURS)
    expect(queryClient.setQueryData).toHaveBeenCalledWith(hooks.inboxAutomationKeys.hours, HOURS)
  })

  it('reads a department\'s hours only with an id, and saves null to follow the company', async () => {
    hooks.useInboxDepartmentWorkingHours(null)
    expect(Vue.toValue(last().enabled as never)).toBe(false)
    hooks.useInboxDepartmentWorkingHours(3)
    expect(Vue.toValue(last().enabled as never)).toBe(true)
    await last().queryFn!()
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/departments/3/working-hours', expect.anything())
    hooks.useSaveInboxDepartmentWorkingHours(3)
    await last().mutationFn!(null as never)
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/departments/3/working-hours', expect.objectContaining({ method: 'PUT', body: { working_hours: null } }))
  })
})

describe('channel automation hooks', () => {
  it('lists the channels an automation manager may pick from the automation route, not the channel-admin one', async () => {
    hooks.useInboxAutomationChannels()
    await last().queryFn!()
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/automation/channels', expect.objectContaining({ schema: expect.anything() }))
  })

  it('reads and patches one channel\'s automatic messages', async () => {
    hooks.useInboxChannelAutomation(5)
    expect(Vue.toValue(last().queryKey as never)).toEqual(['inbox', 'automation', 5])
    await last().queryFn!()
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/channels/5/automation', expect.anything())
    hooks.useSaveInboxChannelAutomation(5)
    await last().mutationFn!({ csat: {} } as never)
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/channels/5/automation', expect.objectContaining({ method: 'PATCH' }))
  })
})

describe('rule hooks', () => {
  it('creates without an id, edits with one, and reloads the list', async () => {
    hooks.useSaveInboxRule()
    await last().mutationFn!({ body: { name: 'a' } } as never)
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/rules', expect.objectContaining({ method: 'POST' }))
    await last().mutationFn!({ id: 7, body: { active: false } } as never)
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/rules/7', expect.objectContaining({ method: 'PATCH', body: { active: false } }))
    await last().onSuccess!({}, {})
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: hooks.inboxAutomationKeys.rules })
  })

  it('deletes a rule and forgets it', async () => {
    hooks.useDeleteInboxRule()
    await last().mutationFn!(7 as never)
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/rules/7', { method: 'DELETE' })
    await last().onSuccess!(undefined, 7)
    expect(queryClient.removeQueries).toHaveBeenCalledWith({ queryKey: hooks.inboxAutomationKeys.rule(7) })
    expect(queryClient.invalidateQueries).toHaveBeenCalled()
  })

  it('posts the new order, reloads whatever the answer, and runs the dry run without a cache write', async () => {
    hooks.useReorderInboxRules()
    await last().mutationFn!([2, 1] as never)
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/rules/reorder', expect.objectContaining({ method: 'POST', body: { ids: [2, 1] } }))
    last().onSuccess!({ items: [], total: 0 }, [2, 1])
    expect(queryClient.setQueryData).toHaveBeenCalledWith(hooks.inboxAutomationKeys.rules, { items: [], total: 0 })
    queryClient.setQueryData.mockClear()
    await last().onSettled!()
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: hooks.inboxAutomationKeys.rules })
    hooks.useTestInboxRules()
    await last().mutationFn!({ channel_id: 1, text: 'مرحبا', option_id: null, at: null } as never)
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/rules/test', expect.objectContaining({ method: 'POST', body: { channel_id: 1, text: 'مرحبا', option_id: null, at: null } }))
    expect(queryClient.setQueryData).not.toHaveBeenCalled()
  })
})
