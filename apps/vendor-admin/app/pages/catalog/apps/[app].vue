<script setup lang="ts">
import { formatBusinessDate } from '@/utils/vendorTime'
import { lifecycleBadge, limitLabel } from '@/utils/vendorCommercial'
import { catalogLabel, tierLabel } from '@/utils/catalogLabels'
import { catalogDiff, parseFeature } from '@/utils/catalogDiff'
import { currentCatalogVersion, type CatalogVersionTier } from '@/utils/vendorCatalogVersions'
import { bundlesWithApp, plansUsingBundles } from '@/utils/vendorCatalog'
import { cadenceLabel, formatCommercialMoney } from '@liwan/commercial-ui/app/utils/commercial'
import type { BundleView } from '@/utils/vendorCommercial'
import { useVendorCatalogVersions } from '@/composables/useVendorCatalogVersions'
import { useVendorCommercial } from '@/composables/useVendorCommercial'
definePageMeta({ capability: 'vendor.read' })
const { t, te, locale } = useI18n(); const route = useRoute(); const api = useVendorCommercial()
const appId = computed(() => String(route.params.app))
// The control plane has no single-entry read: the versions list is loaded and the entry found in it.
const { data: versions, error: loadError, pending, refresh } = await useVendorCatalogVersions().load()
const version = computed(() => currentCatalogVersion(versions.value ?? []))
const tier = computed(() => version.value?.solution.tiers?.find(item => item.id === appId.value) ?? null)
const error = computed(() => loadError.value ?? (versions.value && (!version.value || !tier.value) ? createError({ statusCode: 404, statusMessage: 'not_found' }) : null))
// The rich application comes from the release of this version, when one exists: it is the only place the
// control plane serves `requires`, enforcement refs, `requires_apps` and `conflicts_with_apps` from.
const releaseApp = computed(() =>
  (releases.value ?? []).find(release => release.version === version.value?.version)?.applications.find(app => app.id === appId.value) ?? null)
const { data: releases } = await useAsyncData('vendor:catalog-releases', () => api.releases())
const name = computed(() => (tier.value ? tierLabel(tier.value.id, tier.value.name, t, te) : ''))
const sellable = computed(() => tier.value?.sellable === true && tier.value.id !== 'core')
const modules = computed(() => releaseApp.value?.modules ?? tier.value?.modules ?? [])

type AppFeature = { key: string; kind: 'boolean' | 'limit' | null; ceiling?: number; requires: string[]; enforcementRefs: string[]; label: string }
const features = computed<AppFeature[]>(() => {
  const app = releaseApp.value
  if (app) return app.features.map(feature => ({
    key: feature.key,
    kind: feature.kind,
    ...(feature.ceiling !== undefined ? { ceiling: feature.ceiling } : {}),
    requires: feature.requires,
    enforcementRefs: feature.enforcement_refs,
    label: catalogLabel('feature', `${feature.kind}:${feature.key}`, t),
  }))
  // No release yet: the solution's descriptors are read leniently, and the fields only a release carries stay absent.
  const limits = tier.value?.limits ?? {}
  return (tier.value?.features ?? []).map(raw => {
    const parsed = parseFeature(raw)
    const kind = parsed.kind === 'opaque' ? null : parsed.kind
    const ceiling = parsed.kind === 'limit'
      ? parsed.ceiling ?? (typeof limits[parsed.key] === 'number' ? limits[parsed.key] : undefined)
      : undefined
    return { key: parsed.kind === 'opaque' ? raw : parsed.key, kind, ...(ceiling !== undefined ? { ceiling } : {}), requires: [], enforcementRefs: [], label: catalogLabel('feature', raw, t) }
  })
})
const sellableBadge = computed(() => (sellable.value
  ? { tone: 'success' as const, label: t('vendor.catalog.sellable') }
  : { tone: 'neutral' as const, label: t('vendor.catalog.app.base') }))
// This application's history: for every version, the date, its state and the delta it introduced over the import before it.
const history = computed(() => {
  const list = versions.value ?? []
  return list.map((entry, index) => {
    const diff = index < list.length - 1 ? catalogDiff(entry, list[index + 1]) : null
    const appEntry = diff?.apps.find(app => app.appId === appId.value)
    return {
      entry,
      diff,
      appChanges: !!appEntry,
      // A one-chip delta (a bare add or rename with no feature, limit or module change) reads inline; anything else wraps below.
      diffInline: !!appEntry && !appEntry.featuresAdded.length && !appEntry.featuresRemoved.length && !appEntry.limitChanges.length
        && !appEntry.modulesAdded.length && !appEntry.modulesRemoved.length && appEntry.sellableFrom === appEntry.sellableTo,
    }
  })
})
// What prices this application and what includes those prices; null means the lists could not be loaded.
const { data: usage, error: usageError, pending: usagePending, refresh: refreshUsage } = await useAsyncData(
  () => `vendor:catalog-app-usage:${appId.value}`,
  async () => {
    const bundles = await bundlesWithApp(page => api.listBundles(page), appId.value)
    if (!bundles) return null
    const plans = await plansUsingBundles(page => api.listPlans(page), bundles.map(bundle => bundle.id))
    return plans ? { bundles, plans } : null
  },
  { watch: [appId] },
)
// The add-on that prices this application: the newest bundle revision whose selections include it, of any status.
const addon = computed<BundleView | null>(() => (usage.value?.bundles ?? []).reduce<BundleView | null>(
  (newest, bundle) => (newest && newest.version >= bundle.version ? newest : bundle), null))
// Its price and cadence, beside the settings action; an add-on with no price says so rather than reading as free.
const addonPrice = computed(() => {
  const bundle = addon.value
  if (!bundle) return null
  return bundle.prices.map(price => `${formatCommercialMoney(price.amount, locale.value)} · ${cadenceLabel(price.cadence, t)}`).join(' · ')
    || t('vendor.pricing.prices.none')
})
// The existing add-on form for this application, or a new add-on already selecting it.
const settingsTo = computed(() => (addon.value
  ? { path: `/bundles/${encodeURIComponent(addon.value.id)}/edit`, query: { returnTo: route.fullPath } }
  : { path: '/bundles/new', query: { app: appId.value, returnTo: route.fullPath } }))
// The dependencies only a release records: neither shows on the solution's own descriptors.
const hasDependencies = computed(() => !!releaseApp.value && (releaseApp.value.requires_apps.length > 0 || releaseApp.value.conflicts_with_apps.length > 0))
const retry = () => Promise.all([refresh(), refreshUsage()])
</script>
<template>
  <SharedRecordPage :title="name || t('vendor.catalog.app.details')" back-to="/catalog" :back-label="t('vendor.catalog.applications')" :loading="pending || usagePending" :error="error ?? usageError" @retry="retry">
    <template #actions>
      <div class="flex flex-wrap items-center gap-3">
        <span v-if="usage" class="text-sm text-muted" data-testid="catalog-app-addon-price">{{ addonPrice ?? t('vendor.catalog.app.noAddon') }}</span>
        <UButton :to="settingsTo" color="neutral" variant="outline" data-testid="catalog-app-settings">{{ t('vendor.catalog.app.settings') }}</UButton>
      </div>
    </template>
    <template v-if="tier" #summary>
      <SharedRecordHero :tone="sellable ? 'success' : 'neutral'" icon="i-lucide-boxes">
        <template #title>
          <span class="flex min-w-0 flex-wrap items-center gap-2">
            <SharedStatusBadge size="sm" :tone="sellableBadge.tone" :label="sellableBadge.label" />
            <span aria-hidden="true">·</span>
            {{ name }}
          </span>
        </template>
        <template #meta><span v-if="tier.description" data-testid="catalog-app-description">{{ tier.description }}</span></template>
        <SharedMetricTile density="compact" icon="i-lucide-puzzle" :label="t('vendor.catalog.app.features')" :value="features.length" />
        <SharedMetricTile density="compact" icon="i-lucide-package" :label="t('vendor.catalog.app.modules')" :value="modules.length" />
      </SharedRecordHero>
    </template>
    <template v-if="tier" #aside>
      <SharedPropertiesPanel :title="t('vendor.catalog.app.details')">
        <SharedPropertyRow :label="t('vendor.catalog.app.title')" :value="name" />
        <SharedPropertyRow :label="t('vendor.common.status')"><SharedStatusBadge size="sm" :tone="sellableBadge.tone" :label="sellableBadge.label" /></SharedPropertyRow>
        <SharedPropertyRow data-fact="features" :label="t('vendor.catalog.app.features')" :value="features.length" />
        <SharedPropertyRow :label="t('vendor.catalog.app.modules')" :value="modules.length" />
        <SharedPropertyRow data-fact="bundles" :label="t('vendor.bundles.title')" :value="usage ? usage.bundles.length : null" />
        <SharedPropertyRow data-fact="plans" :label="t('vendor.plans.title')" :value="usage ? usage.plans.length : null" />
      </SharedPropertiesPanel>
    </template>
    <template v-if="tier">
      <SharedRecordSection v-if="features.length" variant="panel" :title="t('vendor.catalog.app.featuresTitle')" data-testid="catalog-app-features">
        <ul class="grid gap-(--liwan-gap-card)">
          <SharedSubCard v-for="feature in features" :key="feature.key" as="li" data-testid="catalog-app-feature">
            <p class="flex flex-wrap items-center gap-2 font-medium">
              {{ feature.label }}
              <UBadge v-if="feature.kind" color="neutral" variant="subtle">{{ t(feature.kind === 'boolean' ? 'vendor.catalog.app.featureBoolean' : 'vendor.catalog.app.featureLimit') }}</UBadge>
            </p>
            <p v-if="feature.kind === 'limit' && feature.ceiling !== undefined" class="mt-1 text-sm tabular-nums text-muted">{{ t('vendor.catalog.app.featureCeiling', { value: limitLabel(feature.ceiling, t, feature.key) }) }}</p>
            <div v-if="feature.requires.length" class="mt-2 flex flex-wrap items-center gap-1.5">
              <span class="text-sm text-muted">{{ t('vendor.catalog.app.requires') }}</span>
              <UBadge v-for="ref in feature.requires" :key="ref" color="neutral" variant="subtle" dir="ltr">{{ ref }}</UBadge>
            </div>
            <div v-if="feature.enforcementRefs.length" class="mt-2 flex flex-wrap items-center gap-1.5">
              <span class="text-sm text-muted">{{ t('vendor.catalog.app.enforcement') }}</span>
              <UBadge v-for="ref in feature.enforcementRefs" :key="ref" color="neutral" variant="subtle" dir="ltr">{{ ref }}</UBadge>
            </div>
          </SharedSubCard>
        </ul>
      </SharedRecordSection>
      <p v-else class="text-sm text-muted" data-testid="catalog-app-features">{{ t('vendor.catalog.app.noFeatures') }}</p>
      <SharedRecordSection v-if="modules.length || hasDependencies" variant="panel" :title="t('vendor.catalog.app.composition')" data-testid="catalog-app-modules">
        <dl class="divide-y divide-default">
          <SharedPropertyRow v-if="modules.length" :label="t('vendor.catalog.app.modules')">
            <span class="flex flex-wrap gap-2"><UBadge v-for="module in modules" :key="module" color="neutral" variant="subtle">{{ catalogLabel('module', module, t) }}</UBadge></span>
          </SharedPropertyRow>
          <SharedPropertyRow v-if="releaseApp && releaseApp.requires_apps.length" :label="t('vendor.catalog.app.requiresApps')">
            <UBadge v-for="id in releaseApp.requires_apps" :key="id" color="neutral" variant="subtle">{{ tierLabel(id, undefined, t, te) }}</UBadge>
          </SharedPropertyRow>
          <SharedPropertyRow v-if="releaseApp && releaseApp.conflicts_with_apps.length" :label="t('vendor.catalog.app.conflictsWithApps')">
            <UBadge v-for="id in releaseApp.conflicts_with_apps" :key="id" color="neutral" variant="subtle">{{ tierLabel(id, undefined, t, te) }}</UBadge>
          </SharedPropertyRow>
        </dl>
      </SharedRecordSection>
      <p v-else class="text-sm text-muted" data-testid="catalog-app-modules">{{ t('vendor.catalog.app.noModules') }}</p>
      <SharedRecordSection v-if="usage && (usage.bundles.length || usage.plans.length)" variant="panel" :title="t('vendor.catalog.app.pricing')" data-testid="catalog-app-pricing">
        <template v-if="usage.bundles.length">
            <h3 class="text-sm font-semibold text-highlighted">{{ t('vendor.bundles.title') }}</h3>
            <ul class="liwan-card-grid mt-3" data-testid="catalog-app-bundles">
              <SharedSubCard v-for="bundle in usage.bundles" :key="bundle.id" as="li">
                <p class="flex flex-wrap items-center justify-between gap-2">
                  <NuxtLink :to="{ path: `/bundles/${encodeURIComponent(bundle.id)}`, query: { returnTo: route.fullPath } }" class="font-medium hover:underline" data-testid="catalog-app-bundle-link">{{ bundle.name }}</NuxtLink>
                  <SharedStatusBadge size="sm" :tone="lifecycleBadge(bundle).tone" :label="t(lifecycleBadge(bundle).labelKey)" />
                </p>
              </SharedSubCard>
            </ul>
          </template>
          <p v-else class="text-sm text-muted">{{ t('vendor.catalog.app.pricingNone') }}</p>
          <template v-if="usage.plans.length">
            <h3 class="mt-4 text-sm font-semibold text-highlighted">{{ t('vendor.plans.title') }}</h3>
            <ul class="liwan-card-grid mt-3" data-testid="catalog-app-plans">
              <SharedSubCard v-for="plan in usage.plans" :key="plan.id" as="li">
                <p class="flex flex-wrap items-center justify-between gap-2">
                  <NuxtLink :to="{ path: `/plans/${encodeURIComponent(plan.id)}`, query: { returnTo: route.fullPath } }" class="font-medium hover:underline" data-testid="catalog-app-plan-link">{{ plan.name }}</NuxtLink>
                  <SharedStatusBadge size="sm" :tone="lifecycleBadge(plan).tone" :label="t(lifecycleBadge(plan).labelKey)" />
                </p>
              </SharedSubCard>
            </ul>
          </template>
          <p v-else class="mt-4 text-sm text-muted">{{ t('vendor.catalog.app.plansNone') }}</p>
      </SharedRecordSection>
      <p v-else-if="usage" class="text-sm text-muted" data-testid="catalog-app-pricing">{{ t('vendor.catalog.app.pricingNone') }}</p>
      <p v-else class="text-sm text-muted" data-testid="catalog-app-pricing-unavailable">{{ t('vendor.catalog.app.pricingUnavailable') }}</p>
      <SharedRecordSection variant="list" :title="t('vendor.catalog.app.history')" data-testid="catalog-app-history">
        <NuxtLink
          v-for="item in history"
          :key="item.entry.id"
          :to="`/catalog/releases/${encodeURIComponent(item.entry.id)}`"
          class="flex items-center gap-3 px-(--liwan-card-pad) py-3 hover:bg-elevated/40"
          data-testid="catalog-app-history-item"
        >
          <span class="grid size-8 shrink-0 place-items-center rounded-control bg-elevated text-muted" aria-hidden="true">
            <UIcon name="i-lucide-tag" class="size-4" />
          </span>
          <div class="min-w-0 flex-1">
            <div class="font-medium tabular-nums text-highlighted" data-testid="catalog-app-history-link"><bdi dir="ltr">{{ item.entry.version }}</bdi></div>
            <div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-muted">
              <UIcon name="i-lucide-calendar" class="size-3.5 shrink-0" aria-hidden="true" />
              <span>{{ formatBusinessDate(item.entry.created_at) }}</span>
              <template v-if="!item.diff"><span aria-hidden="true">·</span><span data-testid="catalog-app-history-first">{{ t('vendor.catalog.timeline.firstImport') }}</span></template>
              <template v-else-if="!item.appChanges"><span aria-hidden="true">·</span><span>{{ t('vendor.catalog.diff.none') }}</span></template>
              <template v-else-if="item.diffInline"><span aria-hidden="true">·</span><VendorCatalogDiffDetail :diff="item.diff" :app-id="appId" class="min-w-0" /></template>
            </div>
            <VendorCatalogDiffDetail v-if="item.diff && item.appChanges && !item.diffInline" :diff="item.diff" :app-id="appId" class="mt-2" />
          </div>
          <SharedStatusBadge size="sm" :tone="lifecycleBadge(item.entry).tone" :label="t(lifecycleBadge(item.entry).labelKey)" />
          <UIcon name="i-lucide-chevron-left" class="size-4 shrink-0 text-muted ltr:rotate-180" aria-hidden="true" />
        </NuxtLink>
      </SharedRecordSection>
    </template>
  </SharedRecordPage>
</template>
