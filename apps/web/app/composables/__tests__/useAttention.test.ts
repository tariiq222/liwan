import { createApp, effectScope, nextTick, ref } from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withManifests } from '../../modules/manifests'
import type { AppAttentionProvider, AppAttentionRow, AppManifest } from '../../modules/types'
import { useAttention } from '../useAttention'

const row = (id: string, tone: AppAttentionRow['tone'] = 'normal'): AppAttentionRow => ({ id, label: id, to: `/${id}`, tone })

function provider(id: string, module: string, capability: string, load: AppAttentionProvider['load']): AppAttentionProvider {
  return { id, module, work: 'execute', capability, queryKey: ['attention', id], load }
}
const manifest = (id: string, attention: AppAttentionProvider[]): AppManifest =>
  ({ id, feature: `${id}.enabled`, routePrefixes: [`/${id}`], rail: [{ id, labelKey: id, icon: 'i-lucide-circle', to: `/${id}`, order: 10 }], nav: [], attention })

interface Identity { id: number; company: { id: number }; capabilities: string[] }
interface Setup { capabilities?: string[]; hydrated?: boolean; identity?: boolean; client?: QueryClient }
const cleanups: Array<() => void> = []

function mountAttention(manifests: AppManifest[], setup: Setup, scope: string | null, options?: { limit?: number }) {
  const api = vi.fn()
  vi.stubGlobal('useApi', () => ({ $api: api }))
  vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
  const me = ref<Identity | null>(setup.identity === false ? null : { id: 7, company: { id: 3 }, capabilities: setup.capabilities ?? [] })
  const hydrated = ref(setup.hydrated ?? true)
  vi.stubGlobal('useAccess', () => ({ can: (capability: string) => (me.value?.capabilities ?? setup.capabilities ?? []).includes(capability) }))
  vi.stubGlobal('useMe', () => ({ me }))
  vi.stubGlobal('useHydrated', () => hydrated)
  const scopeRef = ref<string | null>(scope)
  const app = createApp({ render: () => null })
  const client = setup.client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
  app.use(VueQueryPlugin, { queryClient: client })
  const effects = effectScope()
  const result = withManifests(manifests, () => app.runWithContext(() => effects.run(() => useAttention(scopeRef, options))!))
  cleanups.push(() => { effects.stop(); client.clear() })
  return { ...result, scopeRef, app, me, hydrated, client }
}

async function settle() {
  for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.unstubAllGlobals() })

describe('useAttention', () => {
  it('isolates cached rows immediately through expiry and another user login, including late old responses', async () => {
    let finishOld!: (rows: AppAttentionRow[]) => void
    let finishNew!: (rows: AppAttentionRow[]) => void
    const load = vi.fn()
      .mockResolvedValueOnce([row('A-private-task')])
      .mockImplementationOnce(() => new Promise<AppAttentionRow[]>(resolve => { finishOld = resolve }))
      .mockImplementationOnce(() => new Promise<AppAttentionRow[]>(resolve => { finishNew = resolve }))
    const mounted = mountAttention([manifest('tasks', [provider('tasks', 'tasks', 'tasks.read', load)])], { capabilities: ['tasks.read'] }, 'tasks')
    await settle()
    expect(mounted.rows.value.map(item => item.label)).toEqual(['A-private-task'])
    const oldKey = mounted.client.getQueryCache().findAll({ queryKey: ['attention', 'tasks'] })[0]!.queryKey
    const refresh = mounted.refetch()
    await settle()
    mounted.me.value = null
    expect(mounted.rows.value).toEqual([])
    await settle()
    await mounted.refetch()
    expect(load).toHaveBeenCalledTimes(2)
    mounted.me.value = { id: 8, company: { id: 3 }, capabilities: ['tasks.read'] }
    expect(mounted.rows.value).toEqual([])
    expect(mounted.cappedKinds.value).toEqual([])
    await settle()
    expect(load).toHaveBeenCalledTimes(3)
    expect(mounted.rows.value).toEqual([])
    finishNew([row('B-own-task')])
    await settle()
    expect(mounted.rows.value.map(item => [item.label, item.to])).toEqual([['B-own-task', '/B-own-task']])
    finishOld([row('A-late-private-task')])
    await refresh
    await settle()
    expect(mounted.rows.value.map(item => item.label)).toEqual(['B-own-task'])
    expect(mounted.client.getQueryData<AppAttentionRow[]>(oldKey)?.map(item => item.label)).toEqual(['A-private-task'])
  })

  it('isolates the same user across companies while keeping a warm cache for the same company and user', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    let finishBranch!: (rows: AppAttentionRow[]) => void
    const load = vi.fn().mockResolvedValueOnce([row('company-3-private')])
      .mockImplementationOnce(() => new Promise<AppAttentionRow[]>(resolve => { finishBranch = resolve }))
    const manifests = [manifest('tasks', [provider('tasks', 'tasks', 'tasks.read', load)])]
    const first = mountAttention(manifests, { capabilities: ['tasks.read'], client }, 'tasks')
    await settle()
    expect(first.rows.value.map(item => item.label)).toEqual(['company-3-private'])
    const sameOwner = mountAttention(manifests, { capabilities: ['tasks.read'], client }, 'tasks')
    expect(sameOwner.rows.value.map(item => item.label)).toEqual(['company-3-private'])
    await settle()
    expect(load).toHaveBeenCalledTimes(1)
    first.me.value = { id: 7, company: { id: 4 }, capabilities: ['tasks.read'] }
    expect(first.rows.value).toEqual([])
    expect(first.pending.value).toBe(true)
    expect(first.failed.value).toBe(false)
    await settle()
    expect(first.pending.value).toBe(true)
    expect(load).toHaveBeenCalledTimes(2)
    finishBranch([row('company-4-own')])
    await settle()
    expect(first.rows.value.map(item => item.label)).toEqual(['company-4-own'])
    expect(sameOwner.rows.value.map(item => item.label)).toEqual(['company-3-private'])
  })

  it('hides cached rows while disabled and drops unauthorized providers before a new identity can load them', async () => {
    const taskLoad = vi.fn(async () => [row('private-task')])
    const meetingLoad = vi.fn(async () => [row('own-meeting')])
    const manifests = [manifest('tasks', [provider('tasks', 'tasks', 'tasks.read', taskLoad)]), manifest('meetings', [provider('meetings', 'meetings', 'meetings.read', meetingLoad)])]
    const mounted = mountAttention(manifests, { capabilities: ['tasks.read'] }, 'all')
    await settle()
    expect(mounted.rows.value.map(item => item.label)).toEqual(['private-task'])
    mounted.hydrated.value = false
    expect(mounted.rows.value).toEqual([])
    await mounted.refetch()
    expect(taskLoad).toHaveBeenCalledTimes(1)
    mounted.me.value = { id: 8, company: { id: 3 }, capabilities: ['meetings.read'] }
    mounted.hydrated.value = true
    expect(mounted.rows.value).toEqual([])
    await settle()
    expect(taskLoad).toHaveBeenCalledTimes(1)
    expect(meetingLoad).toHaveBeenCalledTimes(1)
    expect(mounted.rows.value.map(item => item.label)).toEqual(['own-meeting'])
  })

  it('keeps collection-prefix invalidation working for an active identity-scoped provider', async () => {
    const load = vi.fn().mockResolvedValueOnce([row('before-edit')]).mockResolvedValueOnce([row('after-edit')])
    const tasks = provider('tasks', 'tasks', 'tasks.read', load)
    const mounted = mountAttention([manifest('tasks', [tasks])], { capabilities: ['tasks.read'] }, 'tasks')
    await settle()
    expect(mounted.rows.value.map(item => item.label)).toEqual(['before-edit'])
    await mounted.client.invalidateQueries({ queryKey: tasks.queryKey })
    await settle()
    expect(load).toHaveBeenCalledTimes(2)
    expect(mounted.rows.value.map(item => item.label)).toEqual(['after-edit'])
  })

  it('reports the work kinds in which a provider returned as many rows as it may', async () => {
    const full = provider('full', 'tasks', 'tasks.read', async () => Array.from({ length: 20 }, (_, index) => row(`f${index}`)))
    const few = { ...provider('few', 'tasks', 'tasks.read', async () => [row('x1')]), work: 'decide' as const }
    const { cappedKinds } = mountAttention([manifest('tasks', [full, few])], { capabilities: ['tasks.read'] }, 'all', { limit: 100 })
    await settle()
    expect(cappedKinds.value).toEqual(['execute'])
  })

  it('returns the rows of the scope\'s module, urgent first, cut to the default of three', async () => {
    const tasks = provider('tasks', 'tasks', 'tasks.read', async () => [row('t1'), row('t2', 'urgent'), row('t3'), row('t4')])
    const meetings = provider('meetings', 'meetings', 'meetings.read', async () => [row('m1', 'urgent')])
    const { rows, pending, failed } = mountAttention([manifest('tasks', [tasks]), manifest('meetings', [meetings])], { capabilities: ['tasks.read', 'meetings.read'] }, 'tasks')
    expect(pending.value).toBe(true)
    await settle()
    expect(rows.value.map(item => item.id)).toEqual(['tasks:t2', 'tasks:t1', 'tasks:t3'])
    expect(rows.value.every(item => item.module === 'tasks' && item.work === 'execute')).toBe(true)
    expect(pending.value).toBe(false)
    expect(failed.value).toBe(false)
  })

  it('merges every module for \'all\' and honours an explicit limit', async () => {
    const tasks = provider('tasks', 'tasks', 'tasks.read', async () => [row('t1')])
    const meetings = provider('meetings', 'meetings', 'meetings.read', async () => [row('m1', 'urgent'), row('m2')])
    const { rows } = mountAttention([manifest('tasks', [tasks]), manifest('meetings', [meetings])], { capabilities: ['tasks.read', 'meetings.read'] }, 'all', { limit: 2 })
    const all = mountAttention([manifest('tasks', [tasks]), manifest('meetings', [meetings])], { capabilities: ['tasks.read', 'meetings.read'] }, 'all', { limit: 3 })
    await settle()
    // Providers keep rail order (meetings, then tasks); the urgent row leads.
    expect(rows.value.map(item => [item.id, item.module])).toEqual([['meetings:m1', 'meetings'], ['meetings:m2', 'meetings']])
    expect(all.rows.value.map(item => [item.id, item.module])).toEqual([['meetings:m1', 'meetings'], ['meetings:m2', 'meetings'], ['tasks:t1', 'tasks']])
  })

  it('asks nothing and returns nothing for a provider the caller lacks the capability for', async () => {
    const load = vi.fn(async () => [row('t1')])
    const mounted = mountAttention([manifest('tasks', [provider('tasks', 'tasks', 'tasks.read', load)])], { capabilities: [] }, 'tasks')
    await settle()
    expect(load).not.toHaveBeenCalled()
    expect(mounted.rows.value).toEqual([])
    expect(mounted.pending.value).toBe(false)
    expect(mounted.failed.value).toBe(false)
  })

  it('asks nothing for a scope with no providers or no scope', async () => {
    const load = vi.fn(async () => [row('t1')])
    const manifests = [manifest('tasks', [provider('tasks', 'tasks', 'tasks.read', load)])]
    mountAttention(manifests, { capabilities: ['tasks.read'] }, 'finance')
    mountAttention(manifests, { capabilities: ['tasks.read'] }, null)
    await settle()
    expect(load).not.toHaveBeenCalled()
  })

  it('does not fetch before hydration or before the identity is known, and stays pending', async () => {
    const load = vi.fn(async () => [row('t1')])
    const manifests = [manifest('tasks', [provider('tasks', 'tasks', 'tasks.read', load)])]
    const waitingForHydration = mountAttention(manifests, { capabilities: ['tasks.read'], hydrated: false }, 'tasks')
    const waitingForIdentity = mountAttention(manifests, { capabilities: ['tasks.read'], identity: false }, 'tasks')
    await settle()
    expect(load).not.toHaveBeenCalled()
    expect(waitingForHydration.pending.value).toBe(true)
    expect(waitingForIdentity.pending.value).toBe(true)
  })

  it('lets a failing provider contribute nothing while the others still answer', async () => {
    const broken = provider('broken', 'tasks', 'tasks.read', async () => { throw new Error('boom') })
    const working = provider('working', 'tasks', 'tasks.read', async () => [row('w1')])
    const { rows, failed } = mountAttention([manifest('tasks', [broken, working])], { capabilities: ['tasks.read'] }, 'tasks')
    await settle()
    expect(rows.value.map(item => item.id)).toEqual(['working:w1'])
    expect(failed.value).toBe(false)
  })

  it('reports failed only when every provider failed, without throwing', async () => {
    const one = provider('one', 'tasks', 'tasks.read', async () => { throw new Error('boom') })
    const two = provider('two', 'tasks', 'tasks.read', async () => { throw new Error('403') })
    const { rows, failed, pending } = mountAttention([manifest('tasks', [one, two])], { capabilities: ['tasks.read'] }, 'tasks')
    await settle()
    expect(rows.value).toEqual([])
    expect(failed.value).toBe(true)
    expect(pending.value).toBe(false)
  })

  it('follows a changing scope', async () => {
    const tasks = provider('tasks', 'tasks', 'tasks.read', async () => [row('t1')])
    const meetings = provider('meetings', 'meetings', 'meetings.read', async () => [row('m1')])
    const mounted = mountAttention([manifest('tasks', [tasks]), manifest('meetings', [meetings])], { capabilities: ['tasks.read', 'meetings.read'] }, 'tasks')
    await settle()
    expect(mounted.rows.value.map(item => item.id)).toEqual(['tasks:t1'])
    mounted.scopeRef.value = 'meetings'
    await settle()
    expect(mounted.rows.value.map(item => item.id)).toEqual(['meetings:m1'])
  })
})
