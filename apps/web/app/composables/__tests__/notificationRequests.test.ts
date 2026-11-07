import { expect, it, vi } from 'vitest'
import { computed, ref, toValue } from 'vue'
import { QueryClient, QueryObserver } from '@tanstack/vue-query'
import { useMarkNotificationRead, useNotifications } from '../useNotifications'
const state = vi.hoisted(() => ({ qc: null as any, query: null as any }))
vi.mock('@tanstack/vue-query', async original => ({ ...await original<any>(), useMutation: (options: any) => options, useQueryClient: () => state.qc, useQuery: (options: any) => { state.query = options; return options } }))
it('one mark-read starts one page refresh without cancelling and restarting it', async () => {
  vi.stubGlobal('useApi', () => ({ $api: vi.fn() }))
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  state.qc = qc
  let starts = 0, aborted = 0
  const key = ['notifications', 'page']
  qc.setQueryData(key, { pages: [{ items: [], total: 0 }], pageParams: [0] })
  const observer = new QueryObserver(qc, { queryKey: key, staleTime: Infinity, queryFn: ({ signal }) => { starts++; signal.addEventListener('abort', () => { aborted++ }); return new Promise(() => {}) } })
  const stop = observer.subscribe(() => {})
  const mutation = useMarkNotificationRead() as any
  mutation.onSuccess()
  await new Promise(resolve => setTimeout(resolve, 10))
  expect({ starts, aborted }).toEqual({ starts: 1, aborted: 0 })
  stop(); qc.clear()
})
it('allows the bell owner to defer its preview query until enabled', () => {
  vi.stubGlobal('computed', computed); vi.stubGlobal('toValue', toValue)
  vi.stubGlobal('useApi', () => ({ $api: vi.fn() }))
  const enabled = ref(false)
  useNotifications(enabled)
  expect(toValue(state.query.enabled)).toBe(false)
  enabled.value = true
  expect(toValue(state.query.enabled)).toBe(true)
})
