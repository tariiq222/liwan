<script setup lang="ts">
import { formatBusinessDate } from '@/utils/vendorTime'
import { elapsedSince, type Elapsed } from '@/utils/vendorHealth'
import { lifecycleBadge, limitLabel } from '@/utils/vendorCommercial'
import { catalogLabel, tierLabel } from '@/utils/catalogLabels'
import { catalogReturn } from '@/utils/vendorCatalog'
import { catalogDiff, parseFeature } from '@/utils/catalogDiff'
import { legacyDraft, sellableTiers } from '@/utils/vendorCatalogVersions'
import { useVendorCatalogVersions } from '@/composables/useVendorCatalogVersions'
import { useVendorCommercial } from '@/composables/useVendorCommercial'
definePageMeta({ capability: 'vendor.read' })
const { t, te } = useI18n(); const route = useRoute()
const hydrated = useHydrated()
const id = computed(() => String(route.params.id))
// The control plane has no single-entry read: the list is loaded and the entry found in it.
const { data: versions, error: loadError, pending, refresh } = await useVendorCatalogVersions().load()
const items = computed(() => versions.value ?? [])
const version = computed(() => items.value.find(item => item.id === id.value))
const error = computed(() => loadError.value ?? (versions.value && !version.value ? createError({ statusCode: 404, statusMessage: 'not_found' }) : null))
// The record's list origin from the link, else its own tab (DESIGN.md §5).
const back = computed(() => catalogReturn(route.query.returnTo, 'releases')); const backTo = computed(() => back.value.to)
// A published version without a release cannot carry bundles yet; a later version needs its own release.
const { data: releases, error: releasesError, refresh: refreshReleases } = await useAsyncData('vendor:catalog-releases', () => useVendorCommercial().releases())
const hasRelease = computed(() => (releases.value ?? []).some(release => release.version === version.value?.version))
const needsRelease = computed(() => version.value?.status === 'published' && !releasesError.value && !hasRelease.value)
const tiers = computed(() => version.value?.solution.tiers ?? [])
// One readable row per application: features through the shared helpers (never a raw descriptor; an unparseable one hides),
// and a description that would repeat a chip's wording drops so the row reads once.
const rows = computed(() => tiers.value.map(tier => {
  const features = (tier.features ?? []).map(raw => {
    const parsed = parseFeature(raw)
    if (parsed.kind === 'opaque') return null
    const label = catalogLabel('feature', `${parsed.kind}:${parsed.key}`, t)
    return parsed.kind === 'limit' && parsed.ceiling !== undefined ? `${label}: ${limitLabel(parsed.ceiling, t, parsed.key)}` : label
  }).filter((text): text is string => !!text)
  const description = tier.description && !features.includes(tier.description) ? tier.description : null
  return { id: tier.id, name: tierLabel(tier.id, tier.name, t, te), description, features, sellable: tier.sellable === true && tier.id !== 'core' }
}))
const sellableCount = computed(() => (version.value ? sellableTiers(version.value).length : 0))
const baseModules = computed(() => version.value?.solution.base_modules ?? [])
// The change this import introduces over the entry immediately before it by created_at (the list is newest first).
const diff = computed(() => {
  const index = items.value.findIndex(item => item.id === id.value)
  return index >= 0 && items.value[index + 1] ? catalogDiff(version.value, items.value[index + 1]) : null
})
// "Now"-based spans wait for hydration: the server does not know the clock the record is read with.
const now = computed(() => (hydrated.value ? new Date() : null))
const span = (value: Elapsed | null) => (value ? t(`vendor.catalog.timeline.span${value.unit === 'minutes' ? 'Minutes' : value.unit === 'hours' ? 'Hours' : 'Days'}`, { count: value.count }, value.count) : null)
const duration = computed(() => {
  const entry = version.value
  if (!entry) return null
  return entry.published_at ? elapsedSince(entry.created_at, new Date(entry.published_at)) : now.value ? elapsedSince(entry.created_at, now.value) : null
})
const age = computed(() => (version.value?.published_at && now.value ? elapsedSince(version.value.published_at, now.value) : null))
const heroTone = computed(() => (version.value?.status === 'published' ? 'success' as const : version.value?.status === 'validated' ? 'info' as const : 'neutral' as const))
</script>
<template>
  <SharedRecordPage :title="version?.version ?? t('vendor.catalog.details')" :back-to="backTo" :back-label="t(back.labelKey)" :loading="pending" :error="error" @retry="refresh">
    <template v-if="version" #summary>
      <SharedRecordHero :tone="heroTone" icon="i-lucide-layers">
        <template #title>
          <span class="flex min-w-0 flex-wrap items-center gap-2">
            <SharedStatusBadge size="sm" data-slot="lifecycle-badge" :tone="lifecycleBadge(version).tone" :label="t(lifecycleBadge(version).labelKey)" />
            <span aria-hidden="true">·</span>
            <span class="tabular-nums"><bdi dir="ltr">{{ version.version }}</bdi></span>
          </span>
        </template>
        <template #meta>
          <span>{{ t('vendor.catalog.timeline.importedAtMeta', { date: formatBusinessDate(version.created_at) }) }}</span>
          <span v-if="version.imported_by">{{ t('vendor.catalog.timeline.importedBy', { name: version.imported_by }) }}</span>
          <template v-if="version.published_at">
            <span>{{ t('vendor.catalog.timeline.publishedAtMeta', { date: formatBusinessDate(version.published_at) }) }}</span>
            <span v-if="version.published_by">{{ t('vendor.catalog.timeline.publishedBy', { name: version.published_by }) }}</span>
          </template>
        </template>
        <SharedMetricTile density="compact" icon="i-lucide-shopping-cart" :label="t('vendor.catalog.sellableApps')" :value="sellableCount" />
        <SharedMetricTile density="compact" icon="i-lucide-clock" :label="t('vendor.catalog.timeline.duration')" :value="span(duration)" />
      </SharedRecordHero>
    </template>
    <template v-if="version" #aside>
      <SharedPropertiesPanel :title="t('vendor.catalog.versionDetails')">
        <SharedPropertyRow :label="t('vendor.common.status')"><SharedStatusBadge size="sm" :tone="lifecycleBadge(version).tone" :label="t(lifecycleBadge(version).labelKey)" /></SharedPropertyRow>
        <SharedPropertyRow :label="t('vendor.catalog.imported')" :value="formatBusinessDate(version.created_at)" />
        <SharedPropertyRow :label="t('vendor.catalog.timeline.importer')" :value="version.imported_by ?? null" />
        <SharedPropertyRow :label="t('vendor.catalog.timeline.published')" :value="version.published_at ? formatBusinessDate(version.published_at) : null" />
        <SharedPropertyRow :label="t('vendor.catalog.timeline.publishedBy')" :value="version.published_by ?? null" />
        <SharedPropertyRow :label="t('vendor.catalog.timeline.duration')" :value="span(duration)" />
        <SharedPropertyRow :label="t('vendor.catalog.timeline.age')" :value="span(age)" />
        <SharedPropertyRow :label="t('vendor.catalog.sellableApps')" :value="sellableCount" />
        <SharedPropertyRow :label="t('vendor.catalog.baseModules')" :value="baseModules.length" />
      </SharedPropertiesPanel>
    </template>
    <template v-if="version">
      <VendorCatalogGlossary />
      <SharedRecordSection v-if="tiers.length" variant="list" :title="t('vendor.catalog.appsTitle')" data-testid="catalog-apps">
        <div v-for="row in rows" :key="row.id" class="flex items-center gap-3 px-(--liwan-card-pad) py-3" data-testid="catalog-app">
          <span class="grid size-8 shrink-0 place-items-center rounded-control bg-elevated text-muted" aria-hidden="true"><UIcon name="i-lucide-boxes" class="size-4" /></span>
          <span class="min-w-0 flex-1">
            <span class="block font-medium text-highlighted">{{ row.name }}</span>
            <span v-if="row.description" class="mt-0.5 block text-sm text-muted">{{ row.description }}</span>
            <span v-if="row.features.length" class="mt-1 flex flex-wrap gap-1.5"><UBadge v-for="text in row.features" :key="text" color="neutral" variant="subtle">{{ text }}</UBadge></span>
          </span>
          <UBadge v-if="row.sellable" color="success" variant="subtle" data-testid="catalog-sellable">{{ t('vendor.catalog.sellable') }}</UBadge>
          <UBadge v-else color="neutral" variant="subtle">{{ t('vendor.catalog.app.base') }}</UBadge>
        </div>
      </SharedRecordSection>
      <p v-else class="text-sm text-muted" data-testid="catalog-apps">{{ t('vendor.catalog.noApps') }}</p>
      <SharedRecordSection variant="panel" :title="t('vendor.catalog.timeline.changes')" data-testid="catalog-changes">
        <p v-if="!diff" class="text-sm text-muted" data-testid="catalog-first-import">{{ t('vendor.catalog.timeline.firstImport') }}</p>
        <VendorCatalogDiffDetail v-else :diff="diff" />
      </SharedRecordSection>
      <VendorCatalogVersionAction :version="version" @done="refresh" />
      <p v-if="legacyDraft(version.status)" class="text-sm text-muted" data-testid="catalog-legacy-draft">{{ t('vendor.catalog.legacyDraft') }}</p>
      <VendorCatalogReleaseAction v-if="needsRelease" :version="version.version" @done="refreshReleases" />
      <UAlert v-if="version.status === 'published'" color="success" variant="subtle" :title="t('vendor.catalog.publishedTitle')" data-testid="catalog-next-step">
        <template #description><NuxtLink to="/bundles/new" class="font-medium text-primary hover:underline">{{ t('vendor.catalog.toBundles') }}</NuxtLink></template>
      </UAlert>
      <details><summary class="cursor-pointer text-sm text-muted">{{ t('vendor.pricing.technical') }}</summary>
        <dl class="mt-3 space-y-2 text-sm"><div><dt>{{ t('vendor.catalog.baseModules') }}</dt><dd class="flex flex-wrap gap-2"><UBadge v-for="module in baseModules" :key="module" color="neutral" variant="outline">{{ catalogLabel('module', module, t) }}</UBadge></dd></div><div><dt>{{ t('vendor.pricing.revisionId') }}</dt><dd dir="ltr">{{ version.id }}</dd></div></dl>
      </details>
    </template>
  </SharedRecordPage>
</template>
