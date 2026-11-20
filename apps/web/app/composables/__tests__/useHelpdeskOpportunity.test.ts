import * as Vue from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Options = { mutationFn: (value?: unknown) => unknown; onSuccess?: (result: unknown) => unknown; onError?: () => unknown; enabled?: Vue.ComputedRef<boolean>; queryKey?: Vue.ComputedRef<unknown> }
const options: Options[] = []
const cache = new Map<string, unknown>()
const invalidate = vi.fn()
const api = vi.fn()
const granted = new Set<string>()
const keyId = (key: readonly unknown[]) => JSON.stringify(key)
vi.mock('@tanstack/vue-query', () => ({
  keepPreviousData: undefined,
  useQuery: (config: Options) => { options.push(config); return config },
  useMutation: (config: Options) => { options.push(config); return config },
  useQueryClient: () => ({
    setQueryData: (key: readonly unknown[], value: unknown) => cache.set(keyId(key), value),
    invalidateQueries: invalidate,
  }),
}))
vi.stubGlobal('useApi', () => ({ $api: api }))
vi.stubGlobal('useAccess', () => ({ can: (capability: string) => granted.has(capability) }))

const { helpdeskOpportunityErrorMessage, useHelpdeskOpportunityAccess, useHelpdeskOpportunityPick, useLinkTicketOpportunity, useTicketOpportunity, useUnlinkTicketOpportunity } = await import('../useHelpdeskOpportunity')
const key = JSON.stringify(['helpdesk', 'ticket', 7, 'opportunity'])

beforeEach(() => {
  options.length = 0
  cache.clear()
  granted.clear()
  invalidate.mockClear()
  api.mockReset()
})

describe('helpdesk opportunity access', () => {
  it('reads with both read rights and writes with the ticket write right plus CRM read', () => {
    granted.add('helpdesk.tickets.read')
    expect(useHelpdeskOpportunityAccess().read.value).toBe(false)
    granted.add('crm.leads.read')
    const access = useHelpdeskOpportunityAccess()
    expect(access.read.value).toBe(true)
    expect(access.write.value).toBe(false)
    granted.add('helpdesk.tickets.write')
    expect(useHelpdeskOpportunityAccess().write.value).toBe(true)
  })

  it('does not write without CRM read', () => {
    granted.add('helpdesk.tickets.write')
    expect(useHelpdeskOpportunityAccess().write.value).toBe(false)
  })
})

describe('ticket opportunity query and mutations', () => {
  it('reads only while enabled and for a real ticket', () => {
    const enabled = Vue.ref(false)
    useTicketOpportunity(7, enabled)
    expect(options[0]!.enabled!.value).toBe(false)
    enabled.value = true
    expect(options[0]!.enabled!.value).toBe(true)
    useTicketOpportunity(0, true)
    expect(options[1]!.enabled!.value).toBe(false)
  })

  it('links or replaces with a PUT and stores the answer', async () => {
    useLinkTicketOpportunity(7)
    api.mockResolvedValue({ opportunity: { id: 9 }, hidden: false })
    await options[0]!.mutationFn(9)
    expect(api).toHaveBeenCalledWith('/api/v1/helpdesk/tickets/7/opportunity', expect.objectContaining({ method: 'PUT', body: { opportunity_id: 9 } }))
    options[0]!.onSuccess!({ opportunity: { id: 9 }, hidden: false })
    expect(cache.get(key)).toEqual({ opportunity: { id: 9 }, hidden: false })
  })

  it('unlinks with a DELETE and clears both the link and the hidden flag', async () => {
    useUnlinkTicketOpportunity(7)
    cache.set(key, { opportunity: null, hidden: true })
    await options[0]!.mutationFn()
    expect(api).toHaveBeenCalledWith('/api/v1/helpdesk/tickets/7/opportunity', { method: 'DELETE' })
    options[0]!.onSuccess!(undefined)
    expect(cache.get(key)).toEqual({ opportunity: null, hidden: false })
  })

  it('refreshes the link when a write is refused', () => {
    useLinkTicketOpportunity(7)
    useUnlinkTicketOpportunity(7)
    options[0]!.onError!()
    options[1]!.onError!()
    expect(invalidate).toHaveBeenCalledTimes(2)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['helpdesk', 'ticket', 7, 'opportunity'] })
  })
})

describe('opportunity pick', () => {
  it('waits for a search term and asks for every status', async () => {
    const term = Vue.ref('  ')
    useHelpdeskOpportunityPick(term, true)
    expect(options[0]!.enabled!.value).toBe(false)
    term.value = ' منى '
    expect(options[0]!.enabled!.value).toBe(true)
    api.mockResolvedValue({ items: [], total: 0 })
    await (options[0] as unknown as { queryFn: (c: { signal: undefined }) => unknown }).queryFn({ signal: undefined })
    expect(api).toHaveBeenCalledWith('/api/v1/crm/opportunities', expect.objectContaining({ query: { q: 'منى', status: 'all', limit: 20, offset: 0 } }))
  })

  it('stays off while the picker is closed', () => {
    useHelpdeskOpportunityPick('منى', false)
    expect(options[0]!.enabled!.value).toBe(false)
  })
})

describe('helpdeskOpportunityErrorMessage', () => {
  const t = (k: string) => k
  it('names the refusal', () => {
    expect(helpdeskOpportunityErrorMessage({ status: 403 }, t)).toBe('helpdesk.opportunity.errors.forbidden')
    expect(helpdeskOpportunityErrorMessage({ status: 422, field: 'opportunity_id' }, t)).toBe('helpdesk.opportunity.errors.unavailable')
    expect(helpdeskOpportunityErrorMessage({ status: 404 }, t)).toBe('helpdesk.opportunity.errors.missing')
    expect(helpdeskOpportunityErrorMessage(new Error('x'), t)).toBe('errors.generic')
  })
})
