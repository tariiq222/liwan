import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, effectScope } from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { governanceKeys } from '../../../../../composables/projectGovernanceKeys'
import { useUpdateProjectStakeholder, useDeleteProjectStakeholder, useUpdateProjectRegister, useDeleteProjectRegister, useUpdateProjectRaci, useGovernanceTaskPage } from '../../../../../composables/useProjectGovernance'
vi.mock('@liwan/contracts', async () => ({ ...await import('../../../../../../../../packages/contracts/src/pmo/governance'), ...await import('../../../../../../../../packages/contracts/src/pmo/task') }))
const stakeholder = { id: 11, name: 'Saved server name', user: null, organization: 'Org', role: 'Sponsor', contact: '', notes: 'Server note' }
const item = { id: 12, kind: 'issue', title: 'Issue', description: '', priority: 'high', status: 'closed', owner: null, due_date: null, response: 'Handled', task: null, probability: null, impact: null, score: null }
afterEach(() => vi.unstubAllGlobals())
function context<T>(hook: () => T, response: unknown, fail = false) {
  const requests: { path: string; options: { query?: Record<string, unknown> } }[] = []
  vi.stubGlobal('useApi', () => ({ $api: async (path: string, options: { query?: Record<string, unknown> }) => { requests.push({ path, options }); if (fail) throw new Error('Rejected'); return response } }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const app = createApp({}); app.use(VueQueryPlugin, { queryClient: client })
  const scope = effectScope(); const mutation = app.runWithContext(() => scope.run(hook))!
  return { client, mutation, requests, stop: () => { scope.stop(); client.clear() } }
}
describe('governance mutation effects', () => {
  it('replaces complete server details and invalidates the actual stakeholder list and RACI keys', async () => {
    const ctx = context(useUpdateProjectStakeholder, stakeholder)
    const listKey = governanceKeys.stakeholders(7, { q: 'Saved', offset: 50 }); const raciKey = governanceKeys.raci(7)
    ctx.client.setQueryData(listKey, { items: [], total: 0, can_manage: true }); ctx.client.setQueryData(raciKey, { items: [], total: 0, can_manage: true })
    await ctx.mutation.mutateAsync({ projectId: 7, id: 11, body: { name: 'request' } })
    expect(ctx.client.getQueryData(governanceKeys.stakeholder(7, 11))).toEqual(stakeholder)
    expect(ctx.client.getQueryState(listKey)?.isInvalidated).toBe(true)
    expect(ctx.client.getQueryState(raciKey)?.isInvalidated).toBe(true)
    ctx.stop()
  })
  it('replaces register detail from the server and removes it after deletion', async () => {
    const updated = context(useUpdateProjectRegister, item)
    await updated.mutation.mutateAsync({ projectId: 7, id: 12, body: { status: 'closed' } })
    expect(updated.client.getQueryData(governanceKeys.registerItem(7, 12))).toEqual(item)
    updated.stop()
    const removed = context(useDeleteProjectRegister, undefined)
    removed.client.setQueryData(governanceKeys.registerItem(7, 12), item)
    removed.client.setQueryData(governanceKeys.register(7, {}), { items: [item], total: 1, can_manage: true })
    await removed.mutation.mutateAsync({ projectId: 7, id: 12 })
    expect(removed.client.getQueryData(governanceKeys.registerItem(7, 12))).toBeUndefined()
    expect(removed.client.getQueryState(governanceKeys.register(7, {}))?.isInvalidated).toBe(true)
    removed.stop()
  })
  it('removes deleted stakeholder details but preserves the server cache when deletion fails', async () => {
    for (const fail of [false, true]) {
      const ctx = context(useDeleteProjectStakeholder, undefined, fail)
      ctx.client.setQueryData(governanceKeys.stakeholder(7, 11), stakeholder)
      if (fail) await expect(ctx.mutation.mutateAsync({ projectId: 7, id: 11 })).rejects.toThrow('Rejected')
      else await ctx.mutation.mutateAsync({ projectId: 7, id: 11 })
      expect(ctx.client.getQueryData(governanceKeys.stakeholder(7, 11))).toEqual(fail ? stakeholder : undefined)
      ctx.stop()
    }
  })
  it('refreshes the active matrix after changing a role', async () => {
    const row = { id: 3, role: 'A', task: { id: 1, name: 'Task' }, stakeholder: { id: 2, name: 'Sponsor' } }
    const ctx = context(useUpdateProjectRaci, row)
    const key = governanceKeys.raci(7, { task_ids: '1', stakeholder_ids: '2' })
    ctx.client.setQueryData(key, { items: [{ ...row, role: 'R' }], total: 1, can_manage: true })
    await ctx.mutation.mutateAsync({ projectId: 7, id: 3, body: { role: 'A' } })
    expect(ctx.client.getQueryState(key)?.isInvalidated).toBe(true)
    expect(ctx.client.getQueryData(key)).toEqual({ items: [row], total: 1, can_manage: true })
    ctx.stop()
  })
})


it('loads a deep-linked matrix task page directly without first fetching page zero', async () => {
  const response = { items: [], total: 60 }
  const ctx = context(() => useGovernanceTaskPage(7, { q: 'Phase 2', closed: true, offset: 50 }), response)
  await vi.waitFor(() => expect(ctx.mutation.data.value).toEqual(response))
  expect(ctx.requests.map(request => ({ path: request.path, query: request.options.query }))).toEqual([{ path: '/api/v1/tasks', query: { project_id: 7, q: 'Phase 2', closed: 1, limit: 50, offset: 50 } }])
  ctx.stop()
})
