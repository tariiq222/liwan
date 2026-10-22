import { createApp, effectScope, nextTick, ref } from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withManifests } from '../../modules/manifests'
import type { AppAttentionProvider, AppAttentionRow, AppManifest } from '../../modules/types'
import { useAttention } from '../useAttention'

const row = (id: string, tone: AppAttentionRow['tone'] = 'normal'): AppAttentionRow => ({ id, label: id, to: `/${id}`, tone })

function provider(id: string, module: string, capability: string, load: AppAttentionProvider['load']): AppAttentionProvider {
  return { id, module, capability, queryKey: ['attention', id], load }
}
const manifest = (id: string, attention: AppAttentionProvider[]): AppManifest =>
  ({ id, feature: `${id}.enabled`, routePrefixes: [`/${id}`], rail: [{ id, labelKey: id, icon: 'i-lucide-circle', to: `/${id}`, order: 10 }], nav: [], attention })

interface Setup { capabilities?: string[]; hydrated?: boolean; identity?: boolean }

function mountAttention(manifests: AppManifest[], setup: Setup, scope: string | null, options?: { limit?: number }) {
  const api = vi.fn()
  vi.stubGlobal('useApi', () => ({ $api: api }))
  vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
  vi.stubGlobal('useAccess', () => ({ can: (capability: string) => (setup.capabilities ?? []).includes(capability) }))
  vi.stubGlobal('useMe', () => ({ me: ref(setup.identity === false ? null : { capabilities: setup.capabilities ?? [] }) }))
  vi.stubGlobal('useHydrated', () => ref(setup.hydrated ?? true))
  const scopeRef = ref<string | null>(scope)
  const app = createApp({ render: () => null })
  app.use(VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) })
  const result = withManifests(manifests, () => app.runWithContext(() => effectScope().run(() => useAttention(scopeRef, options))!))
  return { ...result, scopeRef, app }
}

async function settle() {
  for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

afterEach(() => vi.unstubAllGlobals())

describe('useAttention', () => {
  it('returns the rows of the scope\'s module, urgent first, cut to the default of three', async () => {
    const tasks = provider('tasks', 'tasks', 'tasks.read', async () => [row('t1'), row('t2', 'urgent'), row('t3'), row('t4')])
    const meetings = provider('meetings', 'meetings', 'meetings.read', async () => [row('m1', 'urgent')])
    const { rows, pending, failed } = mountAttention([manifest('tasks', [tasks]), manifest('meetings', [meetings])], { capabilities: ['tasks.read', 'meetings.read'] }, 'tasks')
    expect(pending.value).toBe(true)
    await settle()
    expect(rows.value.map(item => item.id)).toEqual(['tasks:t2', 'tasks:t1', 'tasks:t3'])
    expect(rows.value.every(item => item.module === 'tasks')).toBe(true)
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
