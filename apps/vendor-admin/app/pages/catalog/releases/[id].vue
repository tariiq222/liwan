<script setup lang="ts">
import { formatBusinessDate } from '@/utils/vendorTime'
import { lifecycleBadge } from '@/utils/vendorCommercial'
import { catalogLabel } from '@/utils/catalogLabels'
import { catalogReturn } from '@/utils/vendorCatalog'
import { catalogDiff } from '@/utils/catalogDiff'
import { sellableTiers } from '@/utils/vendorCatalogVersions'
import { useVendorCatalogVersions } from '@/composables/useVendorCatalogVersions'
import { useVendorCommercial } from '@/composables/useVendorCommercial'
definePageMeta({ capability: 'vendor.read' })
const { t } = useI18n(); const route = useRoute()
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
const sellableCount = computed(() => (version.value ? sellableTiers(version.value).length : 0))
const baseModules = computed(() => version.value?.solution.base_modules ?? [])
// The change this import introduces over the entry immediately before it by created_at (the list is newest first).
const diff = computed(() => {
  const index = items.value.findIndex(item => item.id === id.value)
  return index >= 0 && items.value[index + 1] ? catalogDiff(version.value, items.value[index + 1]) : null
})
</script>
<template>
  <SharedRecordPage :title="version?.version ?? t('vendor.catalog.details')" :back-to="backTo" :back-label="t(back.labelKey)" :loading="pending" :error="error" @retry="refresh">
    <template v-if="version">
      <VendorCatalogGlossary />
      <VendorCatalogFacts :facts="[{ key: 'sellable', label: t('vendor.catalog.sellableApps'), value: sellableCount }, { key: 'imported', label: t('vendor.catalog.imported'), value: formatBusinessDate(version.created_at) }]" class="mt-6">
        <template #status><SharedStatusBadge data-slot="lifecycle-badge" :tone="lifecycleBadge(version).tone" :label="t(lifecycleBadge(version).labelKey)" /></template>
      </VendorCatalogFacts>
      <SharedRecordSection :title="t('vendor.catalog.appsTitle')" class="mt-6" data-testid="catalog-apps">
        <p v-if="!tiers.length" class="text-sm text-muted">{{ t('vendor.catalog.noApps') }}</p>
        <ul v-else class="space-y-3">
          <li v-for="tier in tiers" :key="tier.id" class="rounded-control p-3 ring ring-default" data-testid="catalog-app">
            <p class="flex flex-wrap items-center gap-2 font-medium">{{ tier.name }}<UBadge v-if="tier.sellable === true && tier.id !== 'core'" color="success" variant="subtle" data-testid="catalog-sellable">{{ t('vendor.catalog.sellable') }}</UBadge></p>
            <p v-if="tier.description" class="mt-1 text-sm text-muted">{{ tier.description }}</p>
            <div v-if="tier.features?.length" class="mt-2 flex flex-wrap gap-2"><UBadge v-for="feature in tier.features" :key="feature" color="neutral" variant="subtle">{{ catalogLabel('feature', feature, t) }}</UBadge></div>
          </li>
        </ul>
      </SharedRecordSection>
      <SharedRecordSection :title="t('vendor.catalog.timeline.changes')" class="mt-6" data-testid="catalog-changes">
        <p v-if="!diff" class="text-sm text-muted" data-testid="catalog-first-import">{{ t('vendor.catalog.timeline.firstImport') }}</p>
        <VendorCatalogDiffDetail v-else :diff="diff" />
      </SharedRecordSection>
      <VendorCatalogVersionAction class="mt-6" :version="version" @done="refresh" />
      <VendorCatalogReleaseAction v-if="needsRelease" class="mt-6" :version="version.version" @done="refreshReleases" />
      <UAlert v-if="version.status === 'published'" class="mt-6" color="success" variant="subtle" :title="t('vendor.catalog.publishedTitle')" data-testid="catalog-next-step">
        <template #description><NuxtLink to="/bundles/new" class="font-medium text-primary hover:underline">{{ t('vendor.catalog.toBundles') }}</NuxtLink></template>
      </UAlert>
      <details class="mt-6"><summary class="cursor-pointer text-sm text-muted">{{ t('vendor.pricing.technical') }}</summary>
        <dl class="mt-3 space-y-2 text-sm"><div><dt>{{ t('vendor.catalog.baseModules') }}</dt><dd class="flex flex-wrap gap-2"><UBadge v-for="module in baseModules" :key="module" color="neutral" variant="outline">{{ catalogLabel('module', module, t) }}</UBadge></dd></div><div><dt>{{ t('vendor.pricing.revisionId') }}</dt><dd dir="ltr">{{ version.id }}</dd></div></dl>
      </details>
    </template>
  </SharedRecordPage>
</template>
