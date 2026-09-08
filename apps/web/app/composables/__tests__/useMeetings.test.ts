import { beforeEach, describe, expect, it, vi } from 'vitest'

const vueHooks = vi.hoisted(() => ({ onServerPrefetch: vi.fn() }))
const queryState = vi.hoisted(() => ({
  queries: [] as Array<{ suspense: ReturnType<typeof vi.fn>; enabled?: unknown }>,
}))

vi.mock('vue', async () => ({
  ...(await vi.importActual<typeof import('vue')>('vue')),
  onServerPrefetch: vueHooks.onServerPrefetch,
}))

const invalidateQueries = vi.fn(async () => undefined)

vi.mock('@tanstack/vue-query', () => ({
  useMutation: (options: Record<string, unknown>) => options,
  useQuery: (options: Record<string, unknown>) => {
    const query = { ...options, suspense: vi.fn(async () => undefined) }
    queryState.queries.push(query)
    return query
  },
  useQueryClient: () => ({ invalidateQueries }),
}))

describe('meeting mutation cache invalidation', () => {
  beforeEach(() => {
    invalidateQueries.mockClear()
    vueHooks.onServerPrefetch.mockClear()
    queryState.queries.length = 0
    ;(globalThis as typeof globalThis & { useApi: () => unknown }).useApi = () => ({ $api: vi.fn() })
  })

  it('invalidates meeting and series data after a meeting mutation', async () => {
    const { usePatchMeeting } = await import('../useMeetings')
    const mutation = usePatchMeeting() as { onSuccess?: () => Promise<void> }
    await mutation.onSuccess?.()
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['meetings'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['meeting-series'] })
  })

  it('invalidates meeting data after creating a series for calendar and list views', async () => {
    const { useCreateMeetingSeries } = await import('../useMeetings')
    const mutation = useCreateMeetingSeries() as { onSuccess?: () => Promise<void> }
    await mutation.onSuccess?.()
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['meeting-series'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['meetings'] })
  })

  it('prefetches each enabled meeting read query during SSR', async () => {
    const { useMeetings, useMeeting, useMeetingAttachments, useMeetingSeriesList, useMeetingSeries } = await import('../useMeetings')
    useMeetings({})
    useMeeting(7)
    useMeetingAttachments(7)
    useMeetingSeriesList({})
    useMeetingSeries(12)

    expect(vueHooks.onServerPrefetch).toHaveBeenCalledTimes(5)
    await Promise.all(vueHooks.onServerPrefetch.mock.calls.map(([prefetch]) => prefetch()))
    expect(queryState.queries).toHaveLength(5)
    expect(queryState.queries.every(query => query.suspense.mock.calls.length === 1)).toBe(true)
  })

  it('skips SSR suspense for read queries with invalid IDs', async () => {
    const { useMeetings, useMeeting, useMeetingAttachments, useMeetingSeriesList, useMeetingSeries } = await import('../useMeetings')
    useMeetings({})
    useMeeting(null)
    useMeetingAttachments(null)
    useMeetingSeriesList({})
    useMeetingSeries(null)

    await Promise.all(vueHooks.onServerPrefetch.mock.calls.map(([prefetch]) => prefetch()))
    expect(queryState.queries).toHaveLength(5)
    expect(queryState.queries[0]!.suspense).toHaveBeenCalledTimes(1)
    expect(queryState.queries[1]!.suspense).not.toHaveBeenCalled()
    expect(queryState.queries[2]!.suspense).not.toHaveBeenCalled()
    expect(queryState.queries[3]!.suspense).toHaveBeenCalledTimes(1)
    expect(queryState.queries[4]!.suspense).not.toHaveBeenCalled()
  })

  it('keeps a suspense rejection in the query error state without failing SSR', async () => {
    const { useMeeting } = await import('../useMeetings')
    useMeeting(7)
    queryState.queries[0]!.suspense.mockRejectedValueOnce(new Error('backend unavailable'))

    await expect(Promise.all(vueHooks.onServerPrefetch.mock.calls.map(([prefetch]) => prefetch()))).resolves.toEqual([undefined])
  })
})
