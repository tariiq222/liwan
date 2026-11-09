import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

// The opening report is a named write, so it must never fire from an SSR render (the composable runs while
// `useHydrated` is still false) and must fire exactly once per opened record on the client.
const mutate = vi.fn()
vi.mock('@tanstack/vue-query', () => ({
  useQuery: () => ({}),
  useInfiniteQuery: () => ({}),
  keepPreviousData: {},
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
  useMutation: () => ({ mutate, mutateAsync: vi.fn() }),
}))

const api = vi.fn()
const { useCrmOpportunityOpening } = await import('../useOpportunities')

beforeEach(() => {
  mutate.mockClear()
  api.mockReset()
  vi.stubGlobal('useApi', () => ({ $api: api }))
  vi.stubGlobal('useAccess', () => ({ can: () => true }))
})

async function report(recordId: number, hydrated: boolean) {
  const id = ref(recordId)
  const ready = ref(hydrated)
  useCrmOpportunityOpening(id, ready)
  await nextTick()
  return { id, ready }
}

describe('useCrmOpportunityOpening', () => {
  it('records nothing while the page is server-rendered', async () => {
    await report(7, false)
    expect(mutate).not.toHaveBeenCalled()
  })

  it('records the record once hydration turns true', async () => {
    const { ready } = await report(7, false)
    ready.value = true
    await nextTick()
    expect(mutate).toHaveBeenCalledTimes(1)
  })

  it('records once for one record, however often it is refetched or re-rendered', async () => {
    const { id, ready } = await report(7, true)
    id.value = 7
    ready.value = false
    ready.value = true
    await nextTick()
    expect(mutate).toHaveBeenCalledTimes(1)
  })

  it('records each newly opened record exactly once', async () => {
    const { id } = await report(7, true)
    id.value = 8
    await nextTick()
    expect(mutate).toHaveBeenCalledTimes(2)
  })

  it('ignores a route id that is not a record number', async () => {
    await report(Number.NaN, true)
    await report(0, true)
    expect(mutate).not.toHaveBeenCalled()
  })
})
