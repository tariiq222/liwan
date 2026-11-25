<script setup lang="ts">
import { formatBusinessDate } from '@/utils/vendorTime'
import { lifecycleBadge, limitLabel } from '@/utils/vendorCommercial'
import { catalogLabel, tierLabel } from '@/utils/catalogLabels'
import { catalogDiff, parseFeature } from '@/utils/catalogDiff'
import { currentCatalogVersion, type CatalogVersionTier } from '@/utils/vendorCatalogVersions'
import { bundlesWithApp, plansUsingBundles } from '@/utils/vendorCatalog'
import { useVendorCatalogVersions } from '@/composables/useVendorCatalogVersions'
import { useVendorCommercial } from '@/composables/useVendorCommercial'
definePageMeta({ capability: 'vendor.read' })
const { t, te } = useI18n(); const route = useRoute(); const api = useVendorCommercial()
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
const facts = computed(() => (tier.value ? [
  { key: 'features', label: t('vendor.catalog.app.features'), value: features.value.length },
  { key: 'bundles', label: t('vendor.bundles.title'), value: usage.value ? usage.value.bundles.length : '—' },
  { key: 'plans', label: t('vendor.plans.title'), value: usage.value ? usage.value.plans.length : '—' },
] : []))
const sellableBadge = computed(() => (sellable.value
  ? { tone: 'success' as const, label: t('vendor.catalog.sellable') }
  : { tone: 'neutral' as const, label: t('vendor.catalog.app.notSellable') }))
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
// This application's history: for every version, the date, its state and the delta it introduced over the import before it.
const history = computed(() => {
  const list = versions.value ?? []
  return list.map((entry, index) => ({ entry, diff: index < list.length - 1 ? catalogDiff(entry, list[index + 1]) : null }))
})
const retry = () => Promise.all([refresh(), refreshUsage()])
</script>
<template>
  <SharedRecordPage :title="name || t('vendor.catalog.app.details')" back-to="/catalog" :back-label="t('vendor.catalog.applications')" :loading="pending || usagePending" :error="error ?? usageError" @retry="retry">
    <template v-if="tier">
      <p v-if="tier.description" class="text-sm text-muted" data-testid="catalog-app-description">{{ tier.description }}</p>
      <VendorCatalogFacts :facts="facts" class="mt-6">
        <template #status><SharedStatusBadge data-slot="sellable-badge" :tone="sellableBadge.tone" :label="sellableBadge.label" /></template>
      </VendorCatalogFacts>
      <SharedRecordSection :title="t('vendor.catalog.app.featuresTitle')" class="mt-6" data-testid="catalog-app-features">
        <p v-if="!features.length" class="text-sm text-muted">{{ t('vendor.catalog.app.noFeatures') }}</p>
        <ul v-else class="space-y-3">
          <li v-for="feature in features" :key="feature.key" class="rounded-control p-3 ring ring-default" data-testid="catalog-app-feature">
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
          </li>
        </ul>
      </SharedRecordSection>
      <SharedRecordSection :title="t('vendor.catalog.app.composition')" class="mt-6" data-testid="catalog-app-modules">
        <div v-if="modules.length" class="flex flex-wrap gap-2"><UBadge v-for="module in modules" :key="module" color="neutral" variant="subtle">{{ catalogLabel('module', module, t) }}</UBadge></div>
        <p v-else class="text-sm text-muted">{{ t('vendor.catalog.app.noModules') }}</p>
        <dl v-if="releaseApp && (releaseApp.requires_apps.length || releaseApp.conflicts_with_apps.length)" class="mt-4 space-y-2 text-sm">
          <div v-if="releaseApp.requires_apps.length">
            <dt class="text-muted">{{ t('vendor.catalog.app.requiresApps') }}</dt>
            <dd class="mt-1 flex flex-wrap gap-2"><UBadge v-for="id in releaseApp.requires_apps" :key="id" color="neutral" variant="subtle">{{ tierLabel(id, undefined, t, te) }}</UBadge></dd>
          </div>
          <div v-if="releaseApp.conflicts_with_apps.length">
            <dt class="text-muted">{{ t('vendor.catalog.app.conflictsWithApps') }}</dt>
            <dd class="mt-1 flex flex-wrap gap-2"><UBadge v-for="id in releaseApp.conflicts_with_apps" :key="id" color="neutral" variant="subtle">{{ tierLabel(id, undefined, t, te) }}</UBadge></dd>
          </div>
        </dl>
      </SharedRecordSection>
      <SharedRecordSection :title="t('vendor.catalog.app.pricing')" class="mt-6" data-testid="catalog-app-pricing">
        <p v-if="!usage" class="text-sm text-muted" data-testid="catalog-app-pricing-unavailable">{{ t('vendor.catalog.app.pricingUnavailable') }}</p>
        <template v-else>
          <p v-if="!usage.bundles.length" class="text-sm text-muted">{{ t('vendor.catalog.app.pricingNone') }}</p>
          <ul v-else class="grid gap-2 sm:grid-cols-2" data-testid="catalog-app-bundles">
            <li v-for="bundle in usage.bundles" :key="bundle.id" class="rounded-control p-3 ring ring-default">
              <p class="flex flex-wrap items-center justify-between gap-2">
                <NuxtLink :to="{ path: `/bundles/${encodeURIComponent(bundle.id)}`, query: { returnTo: route.fullPath } }" class="font-medium hover:underline" data-testid="catalog-app-bundle-link">{{ bundle.name }}</NuxtLink>
                <SharedStatusBadge :tone="lifecycleBadge(bundle).tone" :label="t(lifecycleBadge(bundle).labelKey)" />
              </p>
            </li>
          </ul>
          <p v-if="!usage.plans.length" class="mt-4 text-sm text-muted">{{ t('vendor.catalog.app.plansNone') }}</p>
          <ul v-else class="mt-4 grid gap-2 sm:grid-cols-2" data-testid="catalog-app-plans">
            <li v-for="plan in usage.plans" :key="plan.id" class="rounded-control p-3 ring ring-default">
              <p class="flex flex-wrap items-center justify-between gap-2">
                <NuxtLink :to="{ path: `/plans/${encodeURIComponent(plan.id)}`, query: { returnTo: route.fullPath } }" class="font-medium hover:underline" data-testid="catalog-app-plan-link">{{ plan.name }}</NuxtLink>
                <SharedStatusBadge :tone="lifecycleBadge(plan).tone" :label="t(lifecycleBadge(plan).labelKey)" />
              </p>
            </li>
          </ul>
        </template>
      </SharedRecordSection>
      <SharedRecordSection :title="t('vendor.catalog.app.history')" class="mt-6" data-testid="catalog-app-history">
        <ul class="space-y-3">
          <li v-for="item in history" :key="item.entry.id" class="rounded-control p-3 ring ring-default" data-testid="catalog-app-history-item">
            <p class="flex flex-wrap items-center gap-2">
              <span class="font-medium">{{ formatBusinessDate(item.entry.created_at) }}</span>
              <SharedStatusBadge :tone="lifecycleBadge(item.entry).tone" :label="t(lifecycleBadge(item.entry).labelKey)" />
              <NuxtLink :to="`/catalog/releases/${encodeURIComponent(item.entry.id)}`" class="text-sm text-primary hover:underline" dir="ltr" data-testid="catalog-app-history-link">{{ item.entry.version }}</NuxtLink>
            </p>
            <p v-if="!item.diff" class="mt-2 text-sm text-muted" data-testid="catalog-app-history-first">{{ t('vendor.catalog.timeline.firstImport') }}</p>
            <VendorCatalogDiffDetail v-else :diff="item.diff" :app-id="appId" />
          </li>
        </ul>
      </SharedRecordSection>
    </template>
  </SharedRecordPage>
</template>
