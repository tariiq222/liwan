import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, effectScope, ref, type Ref } from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { useMilestones } from '../useMilestones'
import { usePersonalStages } from '../usePersonalStages'
import { useProjectUpdates } from '../useProjectUpdates'
import { useTags } from '../useTags'

afterEach(() => vi.unstubAllGlobals())

const UPDATE = {
  id: 1, name: 'Week 1', status: 'on_track', description_html: '<p>x</p>', date: '2030-01-01', author: { id: 2, name: 'Mona' },
}
const MILESTONE = {
  id: 1, name: 'M', start_date: null, deadline: null, deliverables: [], is_reached: false,
  reached_date: null, task_count: 0, done_task_count: 0,
}
const STAGE = { id: 1, name: 'Inbox', sequence: 1, fold: false }
const TAG = { id: 1, name: 'urgent', color: 2 }

/** Run a composable in an effect scope with a stubbed $api, then await its first page. */
async function firstPage<T>(hook: () => T, response: unknown) {
  const requests: { path: string; query: Record<string, unknown> }[] = []
  vi.stubGlobal('useApi', () => ({
    $api: async (path: string, options: { query?: Record<string, unknown> }) => {
      requests.push({ path, query: options.query ?? {} })
      return response
    },
  }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const app = createApp({})
  app.use(VueQueryPlugin, { queryClient: client })
  const scope = effectScope()
  const result = app.runWithContext(() => scope.run(hook)) as T & { suspense: () => Promise<unknown> }
  await result.suspense()
  return { result, requests, stop: () => { scope.stop(); client.clear() } }
}

describe('the four pmo lists read the {items, total} envelope', () => {
  it('keeps the project update log as one flat list and asks for one bounded page', async () => {
    const ctx = await firstPage(() => useProjectUpdates(ref(7)), { items: [UPDATE], total: 51 })
    expect(ctx.requests[0]).toMatchObject({ path: '/api/v1/projects/7/updates' })
    expect(ctx.requests[0]?.query).toEqual({ limit: 50, offset: 0 })
    expect((ctx.result as unknown as { data: { value: unknown[] } }).data.value).toEqual([UPDATE])
    expect((ctx.result as unknown as { total: { value: number } }).total.value).toBe(51)
    expect((ctx.result as unknown as { hasNextPage: { value: boolean } }).hasNextPage.value).toBe(true)
    ctx.stop()
  })

  it('flattens the milestone pages into the list every picker reads', async () => {
    const ctx = await firstPage(() => useMilestones(ref(7)), { items: [MILESTONE], total: 1 })
    expect(ctx.requests[0]).toMatchObject({ path: '/api/v1/projects/7/milestones' })
    expect((ctx.result as unknown as { data: { value: unknown[] } }).data.value).toEqual([MILESTONE])
    expect((ctx.result as unknown as { hasNextPage: { value: boolean } }).hasNextPage.value).toBe(false)
    ctx.stop()
  })

  it('keeps the tag picker on its own 100-row page', async () => {
    const ctx = await firstPage(() => useTags(ref('urg') as Ref<string>), { items: [TAG], total: 1 })
    expect(ctx.requests[0]).toMatchObject({ path: '/api/v1/tags', query: { q: 'urg', limit: 100, offset: 0 } })
    expect((ctx.result as unknown as { data: { value: unknown[] } }).data.value).toEqual([TAG])
    ctx.stop()
  })

  it('keeps the personal stage vocabulary as one flat list', async () => {
    const ctx = await firstPage(() => usePersonalStages(), { items: [STAGE], total: 1 })
    expect(ctx.requests[0]).toMatchObject({ path: '/api/v1/me/personal-stages' })
    expect((ctx.result as unknown as { data: { value: unknown[] } }).data.value).toEqual([STAGE])
    ctx.stop()
  })
})

describe('a milestone reached by direct link loads its own page', () => {
  it('walks the pages until the requested milestone is loaded', async () => {
    const pages = [
      { items: [{ ...MILESTONE, id: 1 }], total: 3 },
      { items: [{ ...MILESTONE, id: 2 }], total: 3 },
      { items: [{ ...MILESTONE, id: 3 }], total: 3 },
    ]
    const requests: Record<string, unknown>[] = []
    vi.stubGlobal('useApi', () => ({
      $api: async (_path: string, options: { query?: Record<string, unknown> }) => {
        requests.push(options.query ?? {})
        return pages[requests.length - 1]
      },
    }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const app = createApp({})
    app.use(VueQueryPlugin, { queryClient: client })
    const scope = effectScope()
    const query = app.runWithContext(() => scope.run(() => useMilestones(ref(7))))!
    await query.suspense()
    expect(query.data.value.map(item => item.id)).toEqual([1])
    // A direct link to milestone 3 must resolve after loading pages 2 and 3.
    expect((await query.ensureMilestone(3))?.id).toBe(3)
    expect(query.data.value.map(item => item.id)).toEqual([1, 2, 3])
    expect(requests.map(page => page.offset)).toEqual([0, 1, 2])
    expect(await query.ensureMilestone(999)).toBeUndefined()
    scope.stop()
    client.clear()
  })
})
