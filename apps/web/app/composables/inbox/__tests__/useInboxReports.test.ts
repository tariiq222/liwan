import * as Vue from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The recorder of the other query tests: what is asserted is the request each hook makes and the key it caches under.
type Options = { queryKey?: unknown; enabled?: unknown; queryFn?: () => unknown; staleTime?: number }
const seen: Options[] = []
vi.mock('@tanstack/vue-query', () => ({
  useQuery: (options: Options) => { seen.push(options); return {} },
}))
const saveBlob = vi.fn()
vi.mock('../../../utils/saveBlob', () => ({ saveBlob: (...args: unknown[]) => saveBlob(...args) }))
const $api = vi.fn(async (_path: string, _options?: unknown): Promise<unknown> => ({}))
const $download = vi.fn(async (_path: string) => ({ blob: new Blob(['x']), filename: 'inbox-agent.csv' as string | null }))
vi.stubGlobal('useApi', () => ({ $api, $download }))
vi.stubGlobal('computed', Vue.computed)
vi.stubGlobal('toValue', Vue.toValue)

const hooks = await import('../useInboxReports')
const last = () => seen.at(-1)!
const RANGE = { from: '2026-10-01', to: '2026-10-07' }

beforeEach(() => {
  seen.length = 0
  $api.mockClear()
  $download.mockClear()
  saveBlob.mockClear()
})

describe('inbox report queries', () => {
  it('keys the overview by its filters, under the inbox root, and parses with the contract', async () => {
    hooks.useInboxReportOverview({ ...RANGE, channel_id: 2 })
    expect(Vue.toValue(last().queryKey as never)).toEqual(['inbox', 'reports', 'overview', { ...RANGE, channel_id: 2 }])
    await last().queryFn!()
    expect($api).toHaveBeenCalledWith('/api/v1/inbox/reports/overview', expect.objectContaining({ query: { ...RANGE, channel_id: 2 }, schema: expect.anything() }))
  })

  it('waits for hydration through the enabled flag', () => {
    const enabled = Vue.ref(false)
    hooks.useInboxReportOverview(RANGE, enabled)
    expect(Vue.toValue(last().enabled as never)).toBe(false)
    enabled.value = true
    expect(Vue.toValue(last().enabled as never)).toBe(true)
  })

  it('asks the breakdown for its dimension', async () => {
    hooks.useInboxReportBreakdown('agent', RANGE)
    await last().queryFn!()
    expect($api).toHaveBeenCalledWith('/api/v1/inbox/reports/breakdown', expect.objectContaining({ query: { by: 'agent', ...RANGE } }))
    expect(Vue.toValue(last().queryKey as never)).toEqual(['inbox', 'reports', 'breakdown', 'agent', RANGE])
  })

  it('reads costs and drops filters that are not set', async () => {
    hooks.useInboxCostReport({ ...RANGE })
    await last().queryFn!()
    expect($api).toHaveBeenCalledWith('/api/v1/inbox/reports/costs', expect.objectContaining({ query: RANGE }))
  })

  it('does not ask for template analytics before a channel is chosen', async () => {
    hooks.useInboxTemplateAnalytics(null)
    expect(Vue.toValue(last().enabled as never)).toBe(false)
    hooks.useInboxTemplateAnalytics({ channel_id: 1, ...RANGE })
    expect(Vue.toValue(last().enabled as never)).toBe(true)
    await last().queryFn!()
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/reports/templates', expect.objectContaining({ query: { channel_id: 1, ...RANGE } }))
  })

  it('reads one template by id and stays off without one', async () => {
    hooks.useInboxTemplateAnalyticsDetail(null, RANGE)
    expect(Vue.toValue(last().enabled as never)).toBe(false)
    hooks.useInboxTemplateAnalyticsDetail(7, RANGE)
    await last().queryFn!()
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/reports/templates/7', expect.objectContaining({ query: RANGE }))
  })

  it('takes the channel filter options from the cost report, which needs only the reports capability', async () => {
    $api.mockResolvedValueOnce({ channels: [{ channel: { id: 1, name: 'A' }, synced_at: null, error: null }] })
    hooks.useInboxReportChannels('2026-10-29')
    const channels = await last().queryFn!()
    expect($api).toHaveBeenLastCalledWith('/api/v1/inbox/reports/costs', expect.objectContaining({ query: { from: '2026-10-29', to: '2026-10-29' } }))
    expect(channels).toEqual([{ id: 1, name: 'A' }])
  })
})

describe('inbox report export', () => {
  it('downloads the breakdown as CSV under the file name the server chose', async () => {
    await hooks.useInboxReportExport()('agent', { ...RANGE, channel_id: 3 })
    expect($download).toHaveBeenCalledWith('/api/v1/inbox/reports/export?by=agent&from=2026-10-01&to=2026-10-07&channel_id=3')
    expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'inbox-agent.csv')
  })

  it('falls back to a name of its own when the server sends none', async () => {
    $download.mockResolvedValueOnce({ blob: new Blob(['x']), filename: null })
    await hooks.useInboxReportExport()('department', RANGE)
    expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'inbox-department.csv')
  })
})
