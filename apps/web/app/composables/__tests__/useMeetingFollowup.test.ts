import { expect, it, vi } from 'vitest'
import { ref } from 'vue'
vi.mock('vue', async () => ({ ...(await vi.importActual<typeof import('vue')>('vue')), onServerPrefetch: vi.fn() }))
vi.mock('@tanstack/vue-query', () => ({ useQuery: (options: unknown) => options }))
it('uses every followup filter for cache identity and the bounded server request', async () => {
  const api = vi.fn()
  Object.assign(globalThis, { useApi: () => ({ $api: api }) })
  const { useMeetingFollowup } = await import('../useMeetingWorkspace')
  const params = ref({ q: 'متابعة', mine: true, state: 'overdue' as const, limit: 500, offset: 25 })
  const query = useMeetingFollowup(params) as unknown as { queryKey: { value: unknown }; queryFn: () => unknown }
  query.queryFn()
  expect(api).toHaveBeenCalledWith('/api/v1/meetings/resolutions', expect.objectContaining({ query: { q: 'متابعة', mine: true, state: 'overdue', limit: 100, offset: 25 } }))
  expect(query.queryKey.value).toEqual(['meetings', 'follow-up', { q: 'متابعة', mine: true, state: 'overdue', limit: 100, offset: 25 }])
  params.value = { ...params.value, q: 'آخر' }
  expect(query.queryKey.value).toEqual(['meetings', 'follow-up', expect.objectContaining({ q: 'آخر' })])
})
