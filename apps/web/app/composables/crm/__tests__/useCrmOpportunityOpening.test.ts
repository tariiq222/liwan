import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

// The opening report is a named write, so it must never fire from an SSR render (the composable runs while
// `useHydrated` is still false) or for a record the page did not actually read, and must fire exactly once per
// opened record on the client.
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

async function report(recordId: number, hydrated: boolean, loaded = true) {
  const id = ref(recordId)
  const ready = ref(hydrated)
  const open = ref(loaded)
  useCrmOpportunityOpening(id, ready, open)
  await nextTick()
  return { id, ready, open }
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
    const { id, ready, open } = await report(7, true)
    id.value = 7
    ready.value = false
    ready.value = true
    open.value = false
    open.value = true
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

  it('records nothing for a record the read did not return, and records it once that read succeeds', async () => {
    // A 403 or a 404 leaves the record query unsuccessful: there is no view to log, and the POST would fail
    // for the same reason, so a failed read must never write to the personal-data view log.
    const { ready, open } = await report(7, true, false)
    expect(mutate).not.toHaveBeenCalled()
    ready.value = true
    await nextTick()
    expect(mutate).not.toHaveBeenCalled()
    open.value = true
    await nextTick()
    expect(mutate).toHaveBeenCalledTimes(1)
  })

  it('reports nothing for a second record until its own read succeeds', async () => {
    const { id, open } = await report(7, true, false)
    id.value = 8
    await nextTick()
    expect(mutate).not.toHaveBeenCalled()
    open.value = true
    await nextTick()
    expect(mutate).toHaveBeenCalledTimes(1)
  })
})
