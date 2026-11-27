import { computed, type ComputedRef } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { activeManifests } from '../modules/manifests'
import type { AppIcon, AppManifest } from '../modules/types'
import type { AccessIdentity } from '../utils/accessPolicy'
import { deriveCustomerCapabilities } from '../utils/customerCapabilities'

export interface CatalogMoney {
  currency: string
  exponent: number
  minor: number
}

export interface CatalogCadence {
  unit: 'month' | 'year'
  count: number
}

export interface CatalogPrice {
  cadence: CatalogCadence
  amount: CatalogMoney
}

export interface CatalogBundleSelection {
  app_id: string
  feature_keys?: readonly string[]
}

export interface CatalogBundle {
  id: string
  bundle_id?: string
  name: string
  description?: string
  status?: string
  available?: boolean
  selections?: readonly CatalogBundleSelection[]
  prices?: readonly CatalogPrice[]
}

export interface CatalogPlan {
  id: string
  included_bundle_revision_ids?: readonly string[]
  optional_bundle_revision_ids?: readonly string[]
}

export interface CatalogReleaseApp {
  id: string
  name_ar?: string
  name_en?: string
  selectable?: boolean
  sellable?: boolean
  features?: readonly (string | { key: string })[]
}

export interface CatalogPayload {
  plans?: readonly CatalogPlan[]
  bundles?: readonly CatalogBundle[]
  release?: { applications?: readonly CatalogReleaseApp[] } | null
}

export interface SubscriptionAppliedSummary {
  plan_revision_id?: string | null
  bundle_revision_ids?: readonly string[] | null
  cadence?: CatalogCadence | null
}

export interface AvailableAddonModel {
  bundleId: string
  appId: string
  icon: AppIcon
  labelKey: string | null
  descriptionKey: string | null
  nameAr: string
  nameEn: string
  fallbackDescription: string
  primaryPrice: CatalogPrice
  secondaryPrice: CatalogPrice | null
}

const AVAILABLE_ADDONS_STALE_MS = 5 * 60_000
const ENABLED_FEATURE_RE = /^[a-z][a-z0-9_]*\.enabled$/
const FALLBACK_ADDON_ICON: AppIcon = 'i-lucide-package'

function isMissingSubscription(cause: unknown): boolean {
  const err = cause as { statusCode?: number; status?: number; response?: { status?: number } } | null | undefined
  return (err?.statusCode ?? err?.status ?? err?.response?.status) === 404
}

function featureKeyOf(entry: string | { key: string }): string {
  return typeof entry === 'string' ? entry : entry.key
}

function enabledFeatureKeysForApp(app: CatalogReleaseApp | undefined): string[] {
  if (!app?.features?.length) return []
  return app.features.map(featureKeyOf).filter(key => ENABLED_FEATURE_RE.test(key))
}

function enabledFeatureKeysForSelection(selection: CatalogBundleSelection, app: CatalogReleaseApp | undefined): string[] {
  const fromSelection = (selection.feature_keys ?? []).filter(key => ENABLED_FEATURE_RE.test(key))
  if (fromSelection.length > 0) return fromSelection
  return enabledFeatureKeysForApp(app)
}

function resolveCurrentPlan(
  catalog: CatalogPayload | null | undefined,
  subscription: { applied?: SubscriptionAppliedSummary | null } | null | undefined,
): CatalogPlan | null {
  const plans = catalog?.plans ?? []
  if (!plans.length) return null
  const appliedPlanId = subscription?.applied?.plan_revision_id
  return (appliedPlanId ? plans.find(plan => plan.id === appliedPlanId) : undefined) ?? plans[0] ?? null
}

function sameCadence(a: CatalogCadence, b: CatalogCadence): boolean {
  return a.unit === b.unit && a.count === b.count
}

function isMonthly(cadence: CatalogCadence): boolean {
  return cadence.unit === 'month' && cadence.count === 1
}

function isAnnual(cadence: CatalogCadence): boolean {
  return cadence.unit === 'year' && cadence.count === 1
}

/**
 * Whether this identity already owns a catalog `<app>.enabled` feature.
 * Reads `entitlements` when populated; otherwise falls back to `platform.writable_features`.
 */
export function isCatalogFeatureOwned(identity: AccessIdentity, featureKey: string): boolean {
  if (!identity) return false
  if (identity.entitlements && Object.keys(identity.entitlements).length > 0) {
    return identity.entitlements[featureKey] === true
  }
  return identity.platform?.writable_features.includes(featureKey) ?? false
}

/**
 * Picks the primary price (matching `preferredCadence`, else monthly, else annual, else first)
 * and a complementary secondary cadence when one exists. Returns null for an empty price list.
 */
export function selectAddonPrices(
  prices: readonly CatalogPrice[],
  preferredCadence?: CatalogCadence | null,
): { primary: CatalogPrice; secondary: CatalogPrice | null } | null {
  if (!prices.length) return null
  const primary = (preferredCadence ? prices.find(price => sameCadence(price.cadence, preferredCadence)) : undefined)
    ?? prices.find(price => isMonthly(price.cadence))
    ?? prices.find(price => isAnnual(price.cadence))
    ?? prices[0]!
  const others = prices.filter(price => !sameCadence(price.cadence, primary.cadence))
  if (!others.length) return { primary, secondary: null }
  const secondary = primary.cadence.unit === 'month'
    ? (others.find(price => isAnnual(price.cadence)) ?? others.find(price => price.cadence.unit === 'year') ?? others[0] ?? null)
    : (others.find(price => isMonthly(price.cadence)) ?? others.find(price => price.cadence.unit === 'month') ?? others[0] ?? null)
  return { primary, secondary }
}

/**
 * Maps each rail id to `'included' | 'addon'` from the active catalog plan and release applications.
 * Returns an empty map when the catalog, plan, or release application list is unavailable.
 */
export function activeCardPlanMap(input: {
  catalog: CatalogPayload | null | undefined
  subscription?: { applied?: SubscriptionAppliedSummary | null } | null
  manifests?: readonly AppManifest[]
}): Map<string, 'included' | 'addon'> {
  const result = new Map<string, 'included' | 'addon'>()
  const releaseApps = input.catalog?.release?.applications ?? []
  const currentPlan = resolveCurrentPlan(input.catalog, input.subscription)
  if (!currentPlan || !releaseApps.length) return result

  const releaseById = new Map(releaseApps.map(app => [app.id, app]))
  const bundlesById = new Map((input.catalog?.bundles ?? []).map(bundle => [bundle.id, bundle]))
  const includedFeatures = new Set<string>()
  const addonFeatures = new Set<string>()

  for (const app of releaseApps) {
    if (app.selectable === false || (app.id === 'core' && app.selectable !== true)) {
      for (const key of enabledFeatureKeysForApp(app)) includedFeatures.add(key)
    }
  }

  const collectBundleFeatures = (bundleIds: readonly string[] | null | undefined, target: Set<string>) => {
    for (const bundleId of bundleIds ?? []) {
      const bundle = bundlesById.get(bundleId)
      if (!bundle?.selections?.length) continue
      for (const selection of bundle.selections) {
        const app = releaseById.get(selection.app_id)
        for (const key of enabledFeatureKeysForSelection(selection, app)) target.add(key)
      }
    }
  }

  collectBundleFeatures(currentPlan.included_bundle_revision_ids, includedFeatures)
  collectBundleFeatures(currentPlan.optional_bundle_revision_ids, addonFeatures)
  collectBundleFeatures(input.subscription?.applied?.bundle_revision_ids, addonFeatures)

  const manifests = input.manifests ?? activeManifests()
  for (const manifest of manifests) {
    if (!manifest.feature) continue
    const plan = includedFeatures.has(manifest.feature)
      ? 'included'
      : addonFeatures.has(manifest.feature)
        ? 'addon'
        : null
    if (!plan) continue
    for (const rail of manifest.rail) result.set(rail.id, plan)
  }

  return result
}

/**
 * Derives the sellable, not-yet-owned add-on bundles from the live catalog.
 * Fails closed (`[]`) whenever the release application list or current plan is absent.
 */
export function availableAddonsFromCatalog(input: {
  catalog: CatalogPayload | null | undefined
  subscription?: { applied?: SubscriptionAppliedSummary | null } | null
  identity: AccessIdentity
  manifests?: readonly AppManifest[]
}): AvailableAddonModel[] {
  const releaseApps = input.catalog?.release?.applications ?? []
  const currentPlan = resolveCurrentPlan(input.catalog, input.subscription)
  if (!currentPlan || !releaseApps.length) return []

  const releaseById = new Map(releaseApps.map(app => [app.id, app]))
  const includedIds = new Set(currentPlan.included_bundle_revision_ids ?? [])
  const optionalIds = new Set(currentPlan.optional_bundle_revision_ids ?? [])
  const appliedBundleIds = new Set(input.subscription?.applied?.bundle_revision_ids ?? [])
  const preferredCadence = input.subscription?.applied?.cadence ?? null
  const manifests = input.manifests ?? activeManifests()

  const rows: Array<{ order: number; model: AvailableAddonModel }> = []

  for (const bundle of input.catalog?.bundles ?? []) {
    if (bundle.status !== 'published' || bundle.available !== true) continue
    if (!optionalIds.has(bundle.id) || includedIds.has(bundle.id) || appliedBundleIds.has(bundle.id)) continue

    const selections = bundle.selections ?? []
    if (!selections.length) continue

    const resolved = selections.map(selection => ({ selection, app: releaseById.get(selection.app_id) }))
    if (resolved.some(({ app }) => !app || app.sellable !== true)) continue

    const enabledKeys: string[] = []
    let missingFeature = false
    for (const { selection, app } of resolved) {
      const keys = enabledFeatureKeysForSelection(selection, app)
      if (!keys.length) {
        missingFeature = true
        break
      }
      for (const key of keys) {
        if (!enabledKeys.includes(key)) enabledKeys.push(key)
      }
    }
    if (missingFeature || !enabledKeys.length) continue

    if (enabledKeys.every(key => isCatalogFeatureOwned(input.identity, key))) continue

    const prices = selectAddonPrices(bundle.prices ?? [], preferredCadence)
    if (!prices) continue

    const singleApp = resolved.length === 1
    const primaryFeature = enabledKeys[0]!
    const primaryReleaseApp = resolved[0]!.app!
    const manifest = singleApp ? manifests.find(item => item.feature === primaryFeature) : undefined
    const rail = manifest?.rail[0]

    rows.push({
      order: rail?.order ?? Number.MAX_SAFE_INTEGER,
      model: {
        bundleId: bundle.id,
        appId: rail?.id ?? primaryReleaseApp.id,
        icon: rail?.icon ?? FALLBACK_ADDON_ICON,
        labelKey: manifest && rail ? rail.labelKey : null,
        descriptionKey: manifest && rail ? `launcher.apps.${rail.id}.description` : null,
        nameAr: singleApp ? (primaryReleaseApp.name_ar?.trim() || bundle.name) : bundle.name,
        nameEn: singleApp ? (primaryReleaseApp.name_en?.trim() || bundle.name) : bundle.name,
        fallbackDescription: bundle.description?.trim() ?? '',
        primaryPrice: prices.primary,
        secondaryPrice: prices.secondary,
      },
    })
  }

  rows.sort((a, b) => a.order - b.order
    || a.model.appId.localeCompare(b.model.appId)
    || a.model.bundleId.localeCompare(b.model.bundleId))
  return rows.map(row => row.model)
}

function readCommercialEnabled(): boolean {
  try {
    const flag = typeof useRuntimeConfig === 'function'
      ? (useRuntimeConfig() as { public?: { customerCommercialEnabled?: unknown } }).public?.customerCommercialEnabled
      : false
    return flag === true || flag === 'true'
  } catch {
    return false
  }
}

/**
 * Live catalog add-ons and active plan classifications for `/apps`.
 * Requests run only in `saas` with the commercial flag enabled, after hydration, and for callers
 * who derive `subscription.read` (employees and `non_saas` tenants make zero commercial requests).
 */
export function useAvailableAddons(): {
  addons: ComputedRef<AvailableAddonModel[]>
  planOverrides: ComputedRef<Map<string, 'included' | 'addon'>>
  canManage: ComputedRef<boolean>
  loading: ComputedRef<boolean>
} {
  const { me } = useMe()
  const hydrated = useHydrated()
  const api = useSubscriptionApi()
  const commercialOn = computed(() => readCommercialEnabled())
  const capabilities = computed(() => {
    const derived = deriveCustomerCapabilities(me.value?.capabilities)
    return me.value?.read_only === true ? derived.filter(capability => capability !== 'subscription.manage') : derived
  })
  const can = (capability: string) => (capabilities.value as readonly string[]).includes(capability)
  const saas = computed(() => me.value !== null && commercialOn.value && me.value.commercial?.mode !== 'non_saas')
  const canRead = computed(() => saas.value && can('subscription.read'))
  const canManage = computed(() => saas.value && can('subscription.manage'))

  const query = useQuery({
    queryKey: computed(() => ['launcher', 'available-addons', me.value?.company.id ?? null, me.value?.id ?? null]),
    queryFn: async () => {
      const [catalog, subscription] = await Promise.all([
        api.catalog(),
        api.subscription().catch(cause => (isMissingSubscription(cause) ? null : Promise.reject(cause))),
      ])
      return {
        catalog: catalog as unknown as CatalogPayload,
        subscription: subscription as { applied?: SubscriptionAppliedSummary | null } | null,
      }
    },
    enabled: computed(() => hydrated.value && canRead.value),
    staleTime: AVAILABLE_ADDONS_STALE_MS,
    retry: false,
  })

  const addons = computed(() => {
    if (!hydrated.value || !canRead.value || !query.data.value) return []
    return availableAddonsFromCatalog({
      catalog: query.data.value.catalog,
      subscription: query.data.value.subscription,
      identity: me.value,
    })
  })

  const planOverrides = computed(() => {
    if (!hydrated.value || !canRead.value || !query.data.value) return new Map<string, 'included' | 'addon'>()
    return activeCardPlanMap({
      catalog: query.data.value.catalog,
      subscription: query.data.value.subscription,
    })
  })

  const loading = computed(() => hydrated.value && canRead.value && query.isPending.value)

  return { addons, planOverrides, canManage, loading }
}
