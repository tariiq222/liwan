import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, effectScope } from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { baselineKeys } from '../projectBaselineKeys'
import { projectKeys } from '../projectKeys'
import { useTakeBaseline } from '../useProjectBaselines'

const taken = {
  id: 4, project_id: 7, number: 2, taken_by: { id: 5, name: 'Mona' }, taken_at: '2026-11-01T10:00:00Z', note: '', change: null, budget_total: 100,
  currency: null, planned_start: null, planned_end: null, task_count: 0, tasks: [],
}

afterEach(() => vi.unstubAllGlobals())

function context<T>(hook: () => T, response: unknown) {
  const requests: { path: string; options: { method?: string; body?: unknown } }[] = []
  vi.stubGlobal('useApi', () => ({ $api: async (path: string, options: { method?: string; body?: unknown }) => { requests.push({ path, options }); return response } }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const app = createApp({}); app.use(VueQueryPlugin, { queryClient: client })
  const scope = effectScope(); const mutation = app.runWithContext(() => scope.run(hook))!
  return { client, mutation, requests, stop: () => { scope.stop(); client.clear() } }
}

describe('baseline cache', () => {
  it('lives under the project, so a project refresh reaches it', () => {
    expect(baselineKeys.list(7, {}).slice(0, projectKeys.detail(7).length)).toEqual([...projectKeys.detail(7)])
    expect(baselineKeys.variance(7)).toEqual([...baselineKeys.all(7), 'variance'])
  })

  it('posts the note and change, then refreshes the lists, the variance and the project gate', async () => {
    const ctx = context(useTakeBaseline, taken)
    ctx.client.setQueryData(baselineKeys.list(7, {}), { items: [], total: 0 })
    ctx.client.setQueryData(baselineKeys.variance(7), { project_id: 7, baseline: null, schedule: null, cost: null })
    ctx.client.setQueryData(projectKeys.detail(7), { id: 7 })
    await ctx.mutation.mutateAsync({ projectId: 7, body: { note: 'Plan', change_id: 9 } })
    expect(ctx.requests[0]).toMatchObject({ path: '/api/v1/projects/7/baselines', options: { method: 'POST', body: { note: 'Plan', change_id: 9 } } })
    expect(ctx.client.getQueryState(baselineKeys.list(7, {}))?.isInvalidated).toBe(true)
    expect(ctx.client.getQueryState(baselineKeys.variance(7))?.isInvalidated).toBe(true)
    expect(ctx.client.getQueryState(projectKeys.detail(7))?.isInvalidated).toBe(true)
    ctx.stop()
  })
})
