import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, effectScope } from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { changeFilters, changeKeys } from '../projectChangeKeys'
import { projectKeys } from '../projectKeys'
import { useCreateProjectChange, useProjectChangeAction, useUpdateProjectChange, useCreateChangeCategory } from '../useProjectChanges'

const change = {
  id: 4, project_id: 7, number: 1, title: 'Add a report', description: '', reason: '', category: null, state: 'submitted',
  requester: { id: 5, name: 'Sara' }, impact_schedule_days: 3, impact_cost: 10, currency: null, impact_scope: '',
  decided_by: null, decided_at: null, decision_note: '', implemented_at: null, created_at: '2026-11-01T10:00:00Z', updated_at: 'v2',
  can_edit: false, can_submit: false, can_withdraw: true, can_decide: false, can_implement: false,
}

afterEach(() => vi.unstubAllGlobals())

function context<T>(hook: () => T, response: unknown) {
  const requests: { path: string; options: { method?: string; body?: unknown; query?: Record<string, unknown> } }[] = []
  vi.stubGlobal('useApi', () => ({ $api: async (path: string, options: { method?: string; body?: unknown }) => { requests.push({ path, options }); return response } }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const app = createApp({}); app.use(VueQueryPlugin, { queryClient: client })
  const scope = effectScope(); const mutation = app.runWithContext(() => scope.run(hook))!
  return { client, mutation, requests, stop: () => { scope.stop(); client.clear() } }
}

describe('change request filters', () => {
  it('keeps a known state, a positive category and the offset', () => {
    expect(changeFilters({ state: 'approved', category_id: '3', offset: '50' })).toEqual({ state: 'approved', category_id: 3, limit: 50, offset: 50 })
  })

  it('drops anything the server would refuse', () => {
    expect(changeFilters({ state: 'archived', category_id: '0', offset: '-1' })).toEqual({ state: undefined, category_id: undefined, limit: 50, offset: 0 })
    expect(changeFilters({ state: ['approved'], category_id: 'x', offset: 'x' }).state).toBeUndefined()
  })
})

describe('change request cache', () => {
  it('lives under the project, so a project refresh reaches it', () => {
    expect(changeKeys.list(7, {}).slice(0, projectKeys.detail(7).length)).toEqual([...projectKeys.detail(7)])
    expect(changeKeys.item(7, 4)).toEqual([...changeKeys.all(7), 'item', 4])
  })

  it('stores the server answer of a create and refreshes the lists', async () => {
    const ctx = context(useCreateProjectChange, change)
    ctx.client.setQueryData(changeKeys.list(7, {}), { items: [], total: 0, can_create: true })
    await ctx.mutation.mutateAsync({ projectId: 7, body: { title: 'Add a report' } })
    expect(ctx.requests[0]).toMatchObject({ path: '/api/v1/projects/7/changes', options: { method: 'POST', body: { title: 'Add a report' } } })
    expect(ctx.client.getQueryData(changeKeys.item(7, 4))).toEqual(change)
    expect(ctx.client.getQueryState(changeKeys.list(7, {}))?.isInvalidated).toBe(true)
    ctx.stop()
  })

  it('sends the write token with an edit', async () => {
    const ctx = context(useUpdateProjectChange, change)
    await ctx.mutation.mutateAsync({ projectId: 7, id: 4, expected: 'v1', body: { title: 'Better' } })
    expect(ctx.requests[0]).toMatchObject({ path: '/api/v1/projects/7/changes/4', options: { method: 'PATCH', body: { title: 'Better', expected_updated_at: 'v1' } } })
    ctx.stop()
  })

  it('posts an action with the token, and the note only when there is one', async () => {
    const ctx = context(useProjectChangeAction, { ...change, state: 'rejected' })
    await ctx.mutation.mutateAsync({ projectId: 7, id: 4, action: 'reject', expected: 'v2', note: 'No budget' })
    await ctx.mutation.mutateAsync({ projectId: 7, id: 4, action: 'submit', expected: 'v2' })
    expect(ctx.requests.map(request => [request.path, request.options.body])).toEqual([
      ['/api/v1/projects/7/changes/4/reject', { expected_updated_at: 'v2', note: 'No budget' }],
      ['/api/v1/projects/7/changes/4/submit', { expected_updated_at: 'v2' }],
    ])
    expect((ctx.client.getQueryData(changeKeys.item(7, 4)) as { state: string }).state).toBe('rejected')
    ctx.stop()
  })

  it('refreshes the category lists after a category is added', async () => {
    const ctx = context(useCreateChangeCategory, { id: 9, name: 'Legal', sequence: 60, active: true })
    ctx.client.setQueryData([...changeKeys.categories, 'active'], { items: [], total: 0 })
    await ctx.mutation.mutateAsync({ name: 'Legal' })
    expect(ctx.requests[0]?.path).toBe('/api/v1/pmo/change-categories')
    expect(ctx.client.getQueryState([...changeKeys.categories, 'active'])?.isInvalidated).toBe(true)
    ctx.stop()
  })
})
