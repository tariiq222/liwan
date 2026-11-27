import { createSSRApp, effectScope, ref, type EffectScope } from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withManifests } from '../../modules/manifests'
import type { AppManifest } from '../../modules/types'
import {
  activeCardPlanMap,
  availableAddonsFromCatalog,
  isCatalogFeatureOwned,
  selectAddonPrices,
  useAvailableAddons,
  type CatalogBundle,
  type CatalogPayload,
  type CatalogPrice,
  type CatalogReleaseApp,
} from '../useAvailableAddons'

const sar = (minor: number) => ({ currency: 'SAR', exponent: 2, minor })
const M: CatalogPrice['cadence'] = { unit: 'month', count: 1 }
const Y: CatalogPrice['cadence'] = { unit: 'year', count: 1 }
const Q: CatalogPrice['cadence'] = { unit: 'month', count: 3 }
const price = (cadence: CatalogPrice['cadence'], minor: number): CatalogPrice => ({ cadence, amount: sar(minor) })

const manifest = (id: string, railId: string, feature: string, order: number, icon: AppManifest['rail'][number]['icon']): AppManifest => ({
  id,
  feature,
  routePrefixes: [`/${railId}`],
  rail: [{ id: railId, labelKey: `nav.${railId}`, icon, to: `/${railId}`, order }],
  nav: [{ to: `/${railId}`, labelKey: `nav.${railId}`, icon, shortcut: '', capability: `${id}.read` }],
})

const TEST_MANIFESTS: AppManifest[] = [
  manifest('pmo', 'projects', 'pmo.enabled', 20, 'i-lucide-folder-kanban'),
  manifest('hr', 'hr', 'hr.enabled', 50, 'i-lucide-users'),
  manifest('crm', 'crm', 'crm.enabled', 85, 'i-lucide-handshake'),
  manifest('finance', 'finance', 'finance.enabled', 90, 'i-lucide-landmark'),
  manifest('tasks', 'tasks', 'tasks.enabled', 10, 'i-lucide-check-square'),
]

const releaseApps: CatalogReleaseApp[] = [
  { id: 'core', name_ar: 'المنصة', name_en: 'Platform', selectable: false, features: [{ key: 'tasks.enabled' }, { key: 'ai.enabled' }] },
  { id: 'projects', name_ar: 'المشاريع', name_en: 'Projects', selectable: true, sellable: true, features: [{ key: 'pmo.enabled' }, { key: 'pmo.evm' }] },
  { id: 'people', name_ar: 'الموارد البشرية', name_en: 'People', selectable: true, sellable: true, features: [{ key: 'hr.enabled' }, { key: 'hr.payroll' }] },
  { id: 'crm', name_ar: 'إدارة العملاء', name_en: 'CRM', selectable: true, sellable: true, features: [{ key: 'crm.enabled' }] },
  { id: 'finance', name_ar: 'المالية', name_en: 'Finance', selectable: true, sellable: true, features: [{ key: 'finance.enabled' }] },
  { id: 'appointments', name_ar: 'المواعيد', name_en: 'Appointments', selectable: true, sellable: false, features: [{ key: 'appointments.enabled' }] },
  { id: 'sales', name_ar: 'المبيعات', name_en: 'Sales', selectable: true, features: [{ key: 'sales.enabled' }] },
  { id: 'helpdesk', name_ar: 'الدعم الفني', name_en: 'Helpdesk', selectable: true, sellable: false, features: [{ key: 'helpdesk.enabled' }] },
  { id: 'empty_app', name_ar: 'فارغ', name_en: 'Empty', selectable: true, sellable: true, features: [{ key: 'empty.sub_only' }] },
]

const bundle = (id: string, appId: string, over: Partial<CatalogBundle> = {}): CatalogBundle => ({
  id,
  name: `Bundle ${id}`,
  description: `Desc ${id}`,
  status: 'published',
  available: true,
  selections: [{ app_id: appId, feature_keys: [] }],
  prices: [price(M, 25000), price(Y, 250000)],
  ...over,
})

const catalog = (over: Partial<CatalogPayload> = {}): CatalogPayload => ({
  plans: [
    {
      id: 'plan-base',
      included_bundle_revision_ids: ['b-crm'],
      optional_bundle_revision_ids: ['b-hr', 'b-pmo', 'b-fin', 'b-appt', 'b-sales', 'b-helpdesk', 'b-draft', 'b-unavail', 'b-noprice', 'b-nofeat', 'b-empty-sel'],
    },
    {
      id: 'plan-alt',
      included_bundle_revision_ids: [],
      optional_bundle_revision_ids: ['b-crm', 'b-hr'],
    },
  ],
  bundles: [
    bundle('b-crm', 'crm'),
    bundle('b-hr', 'people'),
    bundle('b-pmo', 'projects'),
    bundle('b-fin', 'finance'),
    bundle('b-appt', 'appointments'),
    bundle('b-sales', 'sales'),
    bundle('b-helpdesk', 'helpdesk'),
    bundle('b-draft', 'finance', { status: 'draft' }),
    bundle('b-unavail', 'finance', { available: false }),
    bundle('b-noprice', 'finance', { prices: [] }),
    bundle('b-nofeat', 'empty_app'),
    bundle('b-empty-sel', 'finance', { selections: [] }),
  ],
  release: { applications: releaseApps },
  ...over,
})

describe('isCatalogFeatureOwned', () => {
  it('reads entitlements when populated and ignores platform writable_features', () => {
    const id = {
      entitlements: { 'crm.enabled': true, 'hr.enabled': false },
      platform: { readable_features: ['hr.enabled'], writable_features: ['hr.enabled'] },
    }
    expect(isCatalogFeatureOwned(id, 'crm.enabled')).toBe(true)
    expect(isCatalogFeatureOwned(id, 'hr.enabled')).toBe(false)
    expect(isCatalogFeatureOwned(id, 'finance.enabled')).toBe(false)
  })

  it('falls back to platform.writable_features when entitlements is empty or absent', () => {
    expect(isCatalogFeatureOwned({ entitlements: {}, platform: { readable_features: ['crm.enabled'], writable_features: ['crm.enabled'] } }, 'crm.enabled')).toBe(true)
    expect(isCatalogFeatureOwned({ platform: { readable_features: ['crm.enabled'], writable_features: [] } }, 'crm.enabled')).toBe(false)
    expect(isCatalogFeatureOwned(null, 'crm.enabled')).toBe(false)
  })
})

describe('selectAddonPrices', () => {
  it('returns null when prices are empty', () => {
    expect(selectAddonPrices([])).toBeNull()
  })

  it('prefers the subscription cadence and pairs it with the complementary cadence', () => {
    const list = [price(M, 10000), price(Y, 100000)]
    expect(selectAddonPrices(list, Y)).toEqual({ primary: list[1], secondary: list[0] })
    expect(selectAddonPrices(list, M)).toEqual({ primary: list[0], secondary: list[1] })
  })

  it('falls back to monthly, then annual, then first price, and handles single-price lists', () => {
    const annualOnly = [price(Y, 90000)]
    expect(selectAddonPrices(annualOnly, M)).toEqual({ primary: annualOnly[0], secondary: null })
    const quarterlyAndAnnual = [price(Q, 30000), price(Y, 100000)]
    expect(selectAddonPrices(quarterlyAndAnnual)).toEqual({ primary: quarterlyAndAnnual[1], secondary: quarterlyAndAnnual[0] })
    const quarterlyOnly = [price(Q, 30000)]
    expect(selectAddonPrices(quarterlyOnly)).toEqual({ primary: quarterlyOnly[0], secondary: null })
  })
})

describe('activeCardPlanMap', () => {
  it('returns an empty map when catalog, plan, or release is missing', () => {
    expect(activeCardPlanMap({ catalog: null, manifests: TEST_MANIFESTS }).size).toBe(0)
    expect(activeCardPlanMap({ catalog: { plans: [], release: { applications: releaseApps } }, manifests: TEST_MANIFESTS }).size).toBe(0)
    expect(activeCardPlanMap({ catalog: { plans: [{ id: 'p1' }], release: null }, manifests: TEST_MANIFESTS }).size).toBe(0)
  })

  it('maps core and included bundles to included, optional bundles to addon, and follows applied plan_revision_id', () => {
    const baseMap = activeCardPlanMap({ catalog: catalog(), manifests: TEST_MANIFESTS })
    expect(baseMap.get('tasks')).toBe('included')
    expect(baseMap.get('crm')).toBe('included')
    expect(baseMap.get('projects')).toBe('addon')
    expect(baseMap.get('hr')).toBe('addon')

    const altMap = activeCardPlanMap({
      catalog: catalog(),
      subscription: { applied: { plan_revision_id: 'plan-alt' } },
      manifests: TEST_MANIFESTS,
    })
    expect(altMap.get('tasks')).toBe('included')
    expect(altMap.get('crm')).toBe('addon')
    expect(altMap.get('hr')).toBe('addon')
  })
})

describe('availableAddonsFromCatalog', () => {
  it('fails closed when release applications or plans are absent', () => {
    expect(availableAddonsFromCatalog({ catalog: null, identity: {}, manifests: TEST_MANIFESTS })).toEqual([])
    expect(availableAddonsFromCatalog({ catalog: { ...catalog(), release: null }, identity: {}, manifests: TEST_MANIFESTS })).toEqual([])
    expect(availableAddonsFromCatalog({ catalog: { ...catalog(), plans: [] }, identity: {}, manifests: TEST_MANIFESTS })).toEqual([])
  })

  it('returns only published, available, optional, unowned, priced, sellable bundles sorted by rail order', () => {
    const result = availableAddonsFromCatalog({
      catalog: catalog(),
      subscription: { applied: { plan_revision_id: 'plan-base', bundle_revision_ids: ['b-fin'], cadence: Y } },
      identity: { entitlements: { 'tasks.enabled': true, 'crm.enabled': true } },
      manifests: TEST_MANIFESTS,
    })
    // b-pmo (order 20 -> projects) comes before b-hr (order 50 -> hr); appointments/sales/helpdesk/draft/unavail/noprice/nofeat/empty-sel/b-crm/b-fin are excluded.
    expect(result.map(item => [item.bundleId, item.appId])).toEqual([
      ['b-pmo', 'projects'],
      ['b-hr', 'hr'],
    ])
    expect(result[0]).toMatchObject({
      bundleId: 'b-pmo',
      appId: 'projects',
      icon: 'i-lucide-folder-kanban',
      labelKey: 'nav.projects',
      descriptionKey: 'launcher.apps.projects.description',
      nameAr: 'المشاريع',
      nameEn: 'Projects',
      fallbackDescription: 'Desc b-pmo',
      primaryPrice: price(Y, 250000),
      secondaryPrice: price(M, 25000),
    })
  })

  it('excludes bundles whose feature is already owned via entitlements or writable_features', () => {
    const ownedViaEntitlement = availableAddonsFromCatalog({
      catalog: catalog(),
      identity: { entitlements: { 'pmo.enabled': true, 'hr.enabled': false, 'finance.enabled': false } },
      manifests: TEST_MANIFESTS,
    })
    expect(ownedViaEntitlement.map(item => item.bundleId)).toEqual(['b-hr', 'b-fin'])

    const ownedViaWritable = availableAddonsFromCatalog({
      catalog: catalog(),
      identity: { entitlements: {}, platform: { readable_features: ['hr.enabled'], writable_features: ['hr.enabled'] } },
      manifests: TEST_MANIFESTS,
    })
    expect(ownedViaWritable.map(item => item.bundleId)).toEqual(['b-pmo', 'b-fin'])
  })

  it('resolves *.enabled keys from selection.feature_keys and handles multi-app bundles deterministically', () => {
    const multiCatalog: CatalogPayload = {
      plans: [{ id: 'p1', included_bundle_revision_ids: [], optional_bundle_revision_ids: ['b-suite-b', 'b-suite-a', 'b-mixed-unsellable'] }],
      bundles: [
        bundle('b-suite-b', 'crm', {
          name: 'Suite B',
          selections: [{ app_id: 'crm', feature_keys: ['crm.enabled'] }, { app_id: 'finance', feature_keys: ['finance.enabled'] }],
        }),
        bundle('b-suite-a', 'crm', {
          name: 'Suite A',
          selections: [{ app_id: 'crm', feature_keys: ['crm.enabled'] }, { app_id: 'people', feature_keys: ['hr.enabled'] }],
        }),
        bundle('b-mixed-unsellable', 'crm', {
          name: 'Mixed',
          selections: [{ app_id: 'crm', feature_keys: ['crm.enabled'] }, { app_id: 'appointments', feature_keys: ['appointments.enabled'] }],
        }),
      ],
      release: { applications: releaseApps },
    }
    const items = availableAddonsFromCatalog({
      catalog: multiCatalog,
      identity: { entitlements: { 'crm.enabled': true } },
      manifests: TEST_MANIFESTS,
    })
    // Multi-app bundle stays visible if at least one selected app is unowned; mixed-unsellable is strictly rejected.
    expect(items.map(item => item.bundleId)).toEqual(['b-suite-a', 'b-suite-b'])
    expect(items[0]).toMatchObject({ labelKey: null, descriptionKey: null, icon: 'i-lucide-package', nameAr: 'Suite A', nameEn: 'Suite A' })
  })
})

const scopes: EffectScope[] = []
const clients: QueryClient[] = []
afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop())
  clients.splice(0).forEach(client => client.clear())
  vi.unstubAllGlobals()
})

async function mountComposable(options: {
  me?: Record<string, unknown> | null
  hydrated?: boolean
  commercialEnabled?: boolean
  catalogFn?: ReturnType<typeof vi.fn>
  subscriptionFn?: ReturnType<typeof vi.fn>
} = {}) {
  const meRef = ref(options.me === null ? null : {
    id: 1,
    company: { id: 2 },
    capabilities: ['settings.branding.manage'],
    read_only: false,
    entitlements: { 'tasks.enabled': true, 'crm.enabled': true },
    platform: { state: 'active', readable_features: ['tasks.enabled'], writable_features: ['tasks.enabled'] },
    commercial: { mode: 'saas' },
    ...options.me,
  })
  const catalogFn = options.catalogFn ?? vi.fn(async () => catalog())
  const subscriptionFn = options.subscriptionFn ?? vi.fn(async () => ({ applied: { plan_revision_id: 'plan-base', bundle_revision_ids: ['b-fin'], cadence: M } }))

  vi.stubGlobal('useMe', () => ({ me: meRef }))
  vi.stubGlobal('useHydrated', () => ref(options.hydrated ?? true))
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { customerCommercialEnabled: options.commercialEnabled ?? true } }))
  vi.stubGlobal('useSubscriptionApi', () => ({ catalog: catalogFn, subscription: subscriptionFn }))

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const scope = effectScope()
  const app = createSSRApp({ render: () => null })
  clients.push(qc)
  scopes.push(scope)
  app.use(VueQueryPlugin, { queryClient: qc })

  const state = withManifests(TEST_MANIFESTS, () => app.runWithContext(() => scope.run(() => useAvailableAddons())!))
  await new Promise(resolve => setTimeout(resolve, 25))
  const snapshot = withManifests(TEST_MANIFESTS, () => ({
    addons: state.addons.value,
    planOverrides: state.planOverrides.value,
    canManage: state.canManage.value,
    loading: state.loading.value,
  }))
  return { ...snapshot, catalogFn, subscriptionFn }
}

describe('useAvailableAddons', () => {
  it('makes zero requests for a plain employee without subscription.read', async () => {
    const res = await mountComposable({ me: { capabilities: ['pmo.projects.read'] } })
    expect(res.catalogFn).not.toHaveBeenCalled()
    expect(res.subscriptionFn).not.toHaveBeenCalled()
    expect(res.addons).toEqual([])
    expect(res.canManage).toBe(false)
  })

  it('makes zero requests in non_saas or when the commercial flag is off', async () => {
    const nonSaas = await mountComposable({ me: { commercial: { mode: 'non_saas' } } })
    expect(nonSaas.catalogFn).not.toHaveBeenCalled()
    expect(nonSaas.addons).toEqual([])
    expect(nonSaas.canManage).toBe(false)

    const flagOff = await mountComposable({ commercialEnabled: false })
    expect(flagOff.catalogFn).not.toHaveBeenCalled()
    expect(flagOff.addons).toEqual([])
    expect(flagOff.canManage).toBe(false)
  })

  it('waits until hydrated before issuing commercial requests', async () => {
    const res = await mountComposable({ hydrated: false })
    expect(res.catalogFn).not.toHaveBeenCalled()
    expect(res.subscriptionFn).not.toHaveBeenCalled()
    expect(res.addons).toEqual([])
  })

  it('loads available add-ons and plan overrides for a SaaS billing admin', async () => {
    const res = await mountComposable()
    expect(res.catalogFn).toHaveBeenCalledTimes(1)
    expect(res.subscriptionFn).toHaveBeenCalledTimes(1)
    expect(res.canManage).toBe(true)
    expect(res.addons.map(item => item.bundleId)).toEqual(['b-pmo', 'b-hr'])
    expect(res.planOverrides.get('crm')).toBe('included')
  })

  it('shows add-ons without manage permission for a read-only admin or settings reader', async () => {
    const readOnlyAdmin = await mountComposable({ me: { read_only: true } })
    expect(readOnlyAdmin.canManage).toBe(false)
    expect(readOnlyAdmin.addons.map(item => item.bundleId)).toEqual(['b-pmo', 'b-hr'])

    const reader = await mountComposable({ me: { capabilities: ['access.users.read'] } })
    expect(reader.canManage).toBe(false)
    expect(reader.addons.map(item => item.bundleId)).toEqual(['b-pmo', 'b-hr'])
  })

  it('treats 404 subscription as first-time buyer and falls back gracefully on 503', async () => {
    const missingSub = await mountComposable({
      subscriptionFn: vi.fn(async () => { throw { statusCode: 404 } }),
    })
    expect(missingSub.addons.map(item => item.bundleId)).toEqual(['b-pmo', 'b-hr', 'b-fin'])

    const unavailable = await mountComposable({
      catalogFn: vi.fn(async () => { throw { statusCode: 503 } }),
    })
    expect(unavailable.addons).toEqual([])
    expect(unavailable.planOverrides.size).toBe(0)
  })
})
