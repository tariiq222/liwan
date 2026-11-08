import { createApp, effectScope, nextTick, ref } from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withManifests } from '../../modules/manifests'
import type { AppCard, AppCardFigure, AppManifest } from '../../modules/types'
import { appCardModels, filterAppCards, presentCategories, useAppFigures } from '../useAppCards'

const app = (id: string, order: number, appCard?: AppCard, fixed?: 'top'): AppManifest => ({
  id, feature: `${id}.enabled`, routePrefixes: [`/${id}`],
  rail: [{ id, labelKey: `nav.${id}`, icon: 'i-lucide-circle', to: `/${id}`, order, ...(fixed ? { fixed } : {}) }],
  nav: [{ to: `/${id}`, labelKey: `nav.${id}`, icon: 'i-lucide-circle', shortcut: '', capability: `${id}.read` }],
  ...(appCard ? { appCard } : {}),
})
const figure = (name: string, load: AppCardFigure['load'], capability?: string): AppCardFigure => ({ labelKey: `figure.${name}`, queryKey: ['figure', name], load, ...(capability ? { capability } : {}) })
const manifests = [
  app('tasks', 10, { category: 'team', plan: 'included', surface: 'lav', figures: [figure('a', async () => 1), figure('b', async () => 2), figure('c', async () => 3)] }),
  app('crm', 20, { category: 'sales', plan: 'addon', surface: 'navy' }),
  app('ai', 30, { category: 'team', plan: 'included' }, 'top'),
  app('legacy', 40),
]
const identity = (grants: string[]) => {
  const features = manifests.map(manifest => manifest.feature)
  return { id: 1, capabilities: grants, platform: { state: 'active', read_only: false, readable_features: features, writable_features: features } }
}
const all = ['tasks.read', 'crm.read', 'ai.read', 'legacy.read']
const ids = (cards: Array<{ id: string }>) => cards.map(card => card.id)

describe('appCardModels', () => {
  it('lists the applications the user may open in rail order, without the assistant on home', () => {
    withManifests(manifests, () => {
      expect(ids(appCardModels(identity(all), { assistant: false }))).toEqual(['tasks', 'crm', 'legacy'])
      expect(ids(appCardModels(identity(['crm.read']), { assistant: false }))).toEqual(['crm'])
    })
  })

  it('puts the assistant first on the all-applications page and never lists home or settings', () => {
    withManifests(manifests, () => {
      const listed = ids(appCardModels(identity(all), { assistant: true }))
      expect(listed).toEqual(['ai', 'tasks', 'crm', 'legacy'])
    })
  })

  it('carries the declared category, plan, surface and at most two figures, and pins only what the sidebar does not always show', () => {
    withManifests(manifests, () => {
      const [tasks, crm] = appCardModels(identity(all), { assistant: false })
      expect(tasks).toMatchObject({ category: 'team', plan: 'included', surface: 'lav', pinnable: true })
      expect(tasks!.figures.map(item => item.labelKey)).toEqual(['figure.a', 'figure.b'])
      expect(crm).toMatchObject({ category: 'sales', plan: 'addon', surface: 'navy', figures: [] })
    })
  })

  it('treats an application without a card as a specialised team application on the default surface', () => {
    withManifests(manifests, () => {
      const legacy = appCardModels(identity(all), { assistant: false }).find(card => card.id === 'legacy')
      expect(legacy).toMatchObject({ category: 'team', plan: 'addon', surface: 'lav', figures: [] })
    })
  })

  it('filters by category and offers a chip only for a category somebody can see', () => {
    withManifests(manifests, () => {
      const cards = appCardModels(identity(all), { assistant: false })
      expect(ids(filterAppCards(cards, 'all'))).toEqual(['tasks', 'crm', 'legacy'])
      expect(ids(filterAppCards(cards, 'sales'))).toEqual(['crm'])
      expect(ids(filterAppCards(cards, 'team'))).toEqual(['tasks', 'legacy'])
      expect(presentCategories(cards)).toEqual(['sales', 'team'])
      expect(presentCategories(filterAppCards(cards, 'team'))).toEqual(['team'])
    })
  })
})

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.unstubAllGlobals() })

function mountFigures(figures: AppCardFigure[], setup: { capabilities?: string[]; hydrated?: boolean; api?: unknown } = {}) {
  const api = setup.api ?? vi.fn()
  vi.stubGlobal('useApi', () => ({ $api: api }))
  const me = ref<{ id: number; company: { id: number }; capabilities: string[] } | null>({ id: 7, company: { id: 3 }, capabilities: setup.capabilities ?? [] })
  vi.stubGlobal('useAccess', () => ({ can: (capability: string) => (me.value?.capabilities ?? []).includes(capability) }))
  vi.stubGlobal('useMe', () => ({ me }))
  vi.stubGlobal('useHydrated', () => ref(setup.hydrated ?? true))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const vue = createApp({ render: () => null })
  vue.use(VueQueryPlugin, { queryClient: client })
  const scope = effectScope()
  const result = vue.runWithContext(() => scope.run(() => useAppFigures(() => figures))!)
  cleanups.push(() => { scope.stop(); client.clear() })
  return { result, me }
}
async function settle() {
  for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

describe('useAppFigures', () => {
  it('returns the numbers that arrived and leaves out a figure that failed, never a wrong zero', async () => {
    const { result } = mountFigures([figure('ok', async () => 4), figure('zero', async () => 0), figure('null', async () => null), figure('fail', async () => { throw new Error('boom') })])
    await settle()
    expect(result.value).toEqual([{ labelKey: 'figure.ok', value: 4 }, { labelKey: 'figure.zero', value: 0 }])
  })

  it('does not ask for a figure whose capability the caller lacks', async () => {
    const load = vi.fn(async () => 9)
    const { result } = mountFigures([figure('hidden', load, 'crm.leads.read'), figure('open', async () => 1, 'tasks.read')], { capabilities: ['tasks.read'] })
    await settle()
    expect(load).not.toHaveBeenCalled()
    expect(result.value).toEqual([{ labelKey: 'figure.open', value: 1 }])
  })

  it('asks nothing before the page is hydrated and shows nothing', async () => {
    const load = vi.fn(async () => 1)
    const { result } = mountFigures([figure('x', load)], { hydrated: false })
    await settle()
    expect(load).not.toHaveBeenCalled()
    expect(result.value).toEqual([])
  })

  it('hides the numbers of the previous user when the identity changes, until the new ones arrive', async () => {
    const { result, me } = mountFigures([figure('x', async () => 5)])
    await settle()
    expect(result.value).toHaveLength(1)
    me.value = null
    expect(result.value).toEqual([])
  })
})
