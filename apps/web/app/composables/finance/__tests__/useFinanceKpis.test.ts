import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, effectScope, nextTick, ref, type EffectScope } from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { useFinanceInvoiceSummary, useFinanceEntrySummary, useFinanceAssetSummary, useFinanceBudgetSummary } from '../useFinanceKpis'

const scopes: EffectScope[] = []
const clients: QueryClient[] = []
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals() })
function harness(api: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('useApi', () => ({ $api: api }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); clients.push(client)
  const app = createSSRApp({ render: () => null }); app.use(VueQueryPlugin, { queryClient: client })
  return { client, use<T>(fn: () => T): T { const scope = effectScope(); scopes.push(scope); return app.runWithContext(() => scope.run(fn)!) } }
}
const counts = { total: 9, draft: 2, posted: 6, cancel: 1 }
describe('finance KPI summary transport', () => {
  it.each([
    ['invoices', useFinanceInvoiceSummary, counts], ['entries', useFinanceEntrySummary, counts],
    ['assets', useFinanceAssetSummary, { total: 9, draft: 2, open: 4, close: 2 }],
    ['budgets', useFinanceBudgetSummary, { total: 9, draft: 2, confirmed: 6, cancelled: 1 }],
  ] as const)('loads all %s tiles in one cancellable request and shares the mutation invalidation root', async (resource, hook, body) => {
    const api = vi.fn().mockResolvedValue(body); const view = harness(api)
    const query = view.use(() => hook({ q: 'search' }))
    await expect.poll(() => query.data.value).toEqual(body)
    expect(api).toHaveBeenCalledTimes(1)
    expect(api).toHaveBeenCalledWith(`/api/v1/finance/${resource}/summary`, expect.objectContaining({ query: { q: 'search' }, signal: expect.any(AbortSignal) }))
    await view.client.invalidateQueries({ queryKey: ['finance', resource] })
    expect(api).toHaveBeenCalledTimes(2)
  })
  it('keeps page and selected state outside the request/cache while search and dates refetch', async () => {
    const params = ref({ q: 'alpha', date_from: '2026-01-01', state: 'draft', limit: 25, offset: 0, page: 1, sort: 'name' })
    const api = vi.fn().mockResolvedValue(counts); const view = harness(api)
    const query = view.use(() => useFinanceInvoiceSummary(params))
    await expect.poll(() => query.data.value).toEqual(counts)
    params.value = { ...params.value, state: 'posted', page: 3, offset: 50, sort: '-name' }; await nextTick()
    expect(api).toHaveBeenCalledTimes(1)
    expect(api.mock.calls[0]?.[1].query).toEqual({ q: 'alpha', date_from: '2026-01-01' })
    params.value.q = 'beta'; await expect.poll(() => api.mock.calls.length).toBe(2)
    params.value.date_from = '2026-02-01'; await expect.poll(() => api.mock.calls.length).toBe(3)
  })
  it('retains undefined counts during initial load and exposes failures without invented zero totals', async () => {
    let reject!: (error: Error) => void
    const api = vi.fn(() => new Promise((_resolve, fail) => { reject = fail })); const view = harness(api)
    const query = view.use(() => useFinanceBudgetSummary({}))
    await expect.poll(() => api.mock.calls.length).toBe(1)
    expect(query.data.value).toBeUndefined(); expect(query.isPending.value).toBe(true)
    reject(new Error('forbidden'))
    await expect.poll(() => query.isError.value).toBe(true)
    expect(query.data.value).toBeUndefined()
    expect(query.error.value?.message).toBe('forbidden')
  })
})
