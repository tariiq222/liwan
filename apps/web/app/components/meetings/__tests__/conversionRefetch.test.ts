import { QueryClient } from '@tanstack/vue-query'
import { describe, expect, it } from 'vitest'

// MeetingResolutionsTab.conversionFailureMessage awaits refetchQueries and then reads getQueryData.
// That order is only correct if the awaited refetch has already written the fresh response to the
// cache, as TanStack Query v5 does: each refetch promise is the query's own fetch, which resolves
// after the success state (and its data) is stored. This pins the library behaviour the tab relies on.
describe('meeting detail refetch before reading the cache', () => {
  it('returns the fresh detail from getQueryData once refetchQueries resolves', async () => {
    const client = new QueryClient()
    const key = ['meetings', 7]
    let calls = 0
    const queryFn = async () => {
      calls += 1
      await new Promise(resolve => setTimeout(resolve, 10))
      return { resolutions: [{ id: 9, task_id: calls > 1 ? 5 : null }] }
    }
    await client.fetchQuery({ queryKey: key, queryFn })
    expect(client.getQueryData<{ resolutions: Array<{ task_id: number | null }> }>(key)?.resolutions[0]?.task_id).toBeNull()

    await client.refetchQueries({ queryKey: key })

    expect(calls).toBe(2)
    expect(client.getQueryData<{ resolutions: Array<{ task_id: number | null }> }>(key)?.resolutions[0]?.task_id).toBe(5)
    client.clear()
  })
})
