import { beforeEach, expect, it, vi } from 'vitest'
import { computed, ref, toValue } from 'vue'
import { QueryClient, QueryObserver } from '@tanstack/vue-query'

const state = vi.hoisted(() => ({ query: {} as any, api: vi.fn(), qc: null as any }))
vi.mock('@tanstack/vue-query', async original => ({ ...await original<any>(), useQueryClient: () => state.qc, useQuery: (options: any) => { state.query = options; return options }, useInfiniteQuery: (options: any) => { state.query = options; return options } }))
vi.mock('../useApi', () => ({ useApi: () => ({ $api: state.api }), ApiError: class extends Error {} }))
vi.mock('@/utils/myTaskList', () => ({ MY_TASK_PAGE_SIZE: 50 }))
beforeEach(() => {
  state.qc = new QueryClient()
  vi.stubGlobal('computed', computed); vi.stubGlobal('toValue', toValue)
  vi.stubGlobal('useApi', () => ({ $api: state.api }))
  vi.stubGlobal('useAccess', () => ({ can: () => true }))
  vi.stubGlobal('useMe', () => ({ me: ref({ id: 1, company: { id: 2 } }) }))
  state.api.mockReset().mockResolvedValue({ items: [], total: 0 })
})
const cases = [
  ['tasks', async (p: any) => (await import('../useTasks')).useTasks(p), { closed: false, q: 'first' }, { closed: false, q: 'second' }],
  ['projects', async (p: any) => (await import('../useProjects')).useProjectList(ref(false), p), { q: 'first' }, { q: 'second' }],
  ['employees', async (p: any) => (await import('../useHrEmployees')).useHrEmployees(p), { q: 'first' }, { q: 'second' }],
  ['invoices', async (p: any) => (await import('../finance/useFinanceInvoices')).useFinanceInvoiceList(p), { q: 'first' }, { q: 'second' }],
  ['crm', async (p: any) => (await import('../crm/useOpportunities')).useCrmOpportunities(p), { q: 'first', limit: 20, offset: 0 }, { q: 'second', limit: 20, offset: 0 }],
  ['operations', async (p: any) => (await import('../operations/useOperations')).useOperationRequests(p), { scope: 'mine', q: 'first' }, { scope: 'mine', q: 'second' }],
  ['personal tasks', async (p: any) => (await import('../useMyTaskList')).useMyTaskList(p), { q: 'first' }, { q: 'second' }],
] as const
for (const [name, setup, initial, changed] of cases) {
  it(`${name} captures the query key and forwards cancellation`, async () => {
    const params = ref<any>(initial)
    await setup(params)
    const { queryKey, queryFn } = state.query
    const capturedKey = toValue(queryKey)
    params.value = changed
    const signal = new AbortController().signal
    await queryFn({ queryKey: capturedKey, signal, pageParam: 0 })
    expect(state.api.mock.calls[0]?.[1]?.query?.q).toBe('first')
    expect(state.api.mock.calls[0]?.[1]?.signal).toBe(signal)
  })
}
it('removing the old task observer aborts the actual query transport signal', async () => {
  const { useTasks } = await import('../useTasks')
  useTasks(ref({ closed: false, q: 'old' }))
  const options = state.query
  let signal: AbortSignal | undefined
  state.api.mockImplementation((_path, opts) => { signal = opts.signal; return new Promise(() => {}) })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const observer = new QueryObserver(qc, { queryKey: options.queryKey.value, queryFn: (context: any) => options.queryFn({ ...context, pageParam: 0 }) })
  const stop = observer.subscribe(() => {})
  expect(signal?.aborted).toBe(false)
  stop()
  expect(signal?.aborted).toBe(true)
  qc.clear()
})
