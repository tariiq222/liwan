<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { tierLabel } from '@/utils/catalogLabels'
import { currentCatalogVersion, type CatalogVersionTier } from '@/utils/vendorCatalogVersions'
import { useVendorCatalogVersions } from '@/composables/useVendorCatalogVersions'
definePageMeta({ capability: 'vendor.read' })
const { t, te } = useI18n()
const { data, error, pending, refresh } = await useVendorCatalogVersions().load()
// The offer as it stands: the applications of the published version, else of the latest import.
const version = computed(() => currentCatalogVersion(data.value ?? []))
const apps = computed(() => version.value?.solution.tiers ?? [])
const path = (tier: CatalogVersionTier) => `/catalog/apps/${encodeURIComponent(tier.id)}`
const sellable = (tier: CatalogVersionTier) => tier.sellable === true && tier.id !== 'core'
const columns = computed<TableColumn<CatalogVersionTier>[]>(() => [
  { id: 'app', header: t('vendor.catalog.app.title'), meta: { class: { th: 'min-w-40', td: 'whitespace-nowrap' } } },
  { id: 'description', header: t('vendor.catalog.app.description'), meta: { class: { th: 'min-w-56', td: 'min-w-56' } } },
  { id: 'sellable', header: t('vendor.catalog.sellableApps'), meta: { class: { th: 'w-40', td: 'w-40 whitespace-nowrap' } } },
])
</script>
<template>
  <SharedListPage :title="t('vendor.catalog.applications')">
    <template #filters><VendorCatalogTabs class="mb-3" /></template>
    <VendorCatalogGlossary class="mb-4" />
    <UAlert v-if="version && version.status !== 'published'" class="mb-4" color="info" variant="subtle" :title="t('vendor.catalog.notPublishedTitle')" data-testid="catalog-not-published">
      <template #description><NuxtLink to="/catalog/releases" class="font-medium text-primary hover:underline">{{ t('vendor.catalog.toReleases') }}</NuxtLink></template>
    </UAlert>
    <SharedDataTable :rows="apps" :columns="columns" row-key="id" :row-to="path" :loading="pending" :error="error" :empty-text="t('vendor.catalog.empty')" :caption="t('vendor.catalog.applications')" @retry="refresh">
      <template #app-cell="{ row: { original: tier } }"><NuxtLink :to="path(tier)" data-testid="catalog-app-row" class="font-medium hover:underline">{{ tierLabel(tier.id, tier.name, t, te) }}</NuxtLink></template>
      <template #description-cell="{ row: { original: tier } }"><span v-if="tier.description" class="text-muted">{{ tier.description }}</span></template>
      <template #sellable-cell="{ row: { original: tier } }">
        <UBadge v-if="sellable(tier)" color="success" variant="subtle" data-testid="catalog-app-sellable">{{ t('vendor.catalog.sellable') }}</UBadge>
        <UBadge v-else color="neutral" variant="subtle">{{ t('vendor.catalog.app.base') }}</UBadge>
      </template>
      <template #mobile-row="{ row: tier }">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <h2 class="text-lg font-semibold"><NuxtLink :to="path(tier)" data-testid="catalog-app-row">{{ tierLabel(tier.id, tier.name, t, te) }}</NuxtLink></h2>
          <UBadge v-if="sellable(tier)" color="success" variant="subtle">{{ t('vendor.catalog.sellable') }}</UBadge>
          <UBadge v-else color="neutral" variant="subtle">{{ t('vendor.catalog.app.base') }}</UBadge>
        </div>
        <p v-if="tier.description" class="mt-3 text-sm text-muted">{{ tier.description }}</p>
      </template>
    </SharedDataTable>
  </SharedListPage>
</template>
