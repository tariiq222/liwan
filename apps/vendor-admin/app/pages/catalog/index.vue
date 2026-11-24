<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { formatBusinessDate } from '@/utils/vendorTime'
import { lifecycleBadge } from '@/utils/vendorCommercial'
import { sellableTiers, type CatalogVersion } from '@/utils/vendorCatalogVersions'
import { useVendorCatalogVersions } from '@/composables/useVendorCatalogVersions'
definePageMeta({ capability: 'vendor.read' })
const { t } = useI18n()
const { data, error, pending, refresh } = await useVendorCatalogVersions().load()
const items = computed(() => data.value ?? [])
const path = (version: CatalogVersion) => ({ path: `/catalog/${encodeURIComponent(version.id)}` })
// The order things are built in: each step is made of the one before it.
const steps = [
  { key: 'apps', to: '/catalog' },
  { key: 'bundles', to: '/bundles' },
  { key: 'plans', to: '/plans' },
] as const
const columns = computed<TableColumn<CatalogVersion>[]>(() => [
  { id: 'version', header: t('vendor.catalog.version'), meta: { class: { th: 'min-w-44', td: 'whitespace-nowrap' } } },
  { id: 'status', header: t('vendor.common.status'), meta: { class: { th: 'w-36', td: 'w-36 whitespace-nowrap' } } },
  { id: 'sellable', header: t('vendor.catalog.sellableApps'), meta: { class: { th: 'w-36', td: 'w-36 whitespace-nowrap' } } },
  { id: 'created', header: t('vendor.catalog.imported'), meta: { class: { th: 'w-40', td: 'w-40 whitespace-nowrap' } } },
])
</script>
<template>
  <SharedListPage :title="t('vendor.catalog.applications')">
    <template #filters><VendorCatalogTabs class="mb-3" /></template>
    <VendorCatalogGlossary class="mb-4" />
    <section class="mb-4 space-y-3" data-testid="catalog-steps">
      <p class="text-sm text-muted">{{ t('vendor.catalog.intro') }}</p>
      <ol class="grid gap-2 text-sm sm:grid-cols-3" :aria-label="t('vendor.catalog.stepsLabel')">
        <li v-for="(step, index) in steps" :key="step.key" class="rounded-control p-3 ring ring-default" :aria-current="index === 0 ? 'step' : undefined">
          <NuxtLink :to="step.to" class="flex items-center gap-3 font-medium hover:underline"><UBadge :color="index === 0 ? 'primary' : 'neutral'" :variant="index === 0 ? 'solid' : 'outline'">{{ index + 1 }}</UBadge>{{ t(`vendor.catalog.steps.${step.key}.title`) }}</NuxtLink>
          <p class="mt-1 text-muted">{{ t(`vendor.catalog.steps.${step.key}.hint`) }}</p>
        </li>
      </ol>
    </section>
    <SharedDataTable :rows="items" :columns="columns" row-key="id" :row-to="path" :loading="pending" :error="error" :empty-text="t('vendor.catalog.empty')" :caption="t('vendor.catalog.applications')" @retry="refresh">
      <template #version-cell="{ row: { original: version } }"><NuxtLink :to="path(version)" data-testid="catalog-row" class="font-medium hover:underline" dir="ltr">{{ version.version }}</NuxtLink></template>
      <template #status-cell="{ row: { original: version } }"><SharedStatusBadge :tone="lifecycleBadge(version).tone" :label="t(lifecycleBadge(version).labelKey)" /></template>
      <template #sellable-cell="{ row: { original: version } }">{{ sellableTiers(version).length }}</template>
      <template #created-cell="{ row: { original: version } }">{{ formatBusinessDate(version.created_at) }}</template>
      <template #mobile-row="{ row: version }">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <h2 class="text-lg font-semibold"><NuxtLink :to="path(version)" data-testid="catalog-row" dir="ltr">{{ version.version }}</NuxtLink></h2>
          <SharedStatusBadge :tone="lifecycleBadge(version).tone" :label="t(lifecycleBadge(version).labelKey)" />
        </div>
        <p class="mt-3 text-sm text-muted">{{ t('vendor.catalog.sellableApps') }}: {{ sellableTiers(version).length }} · {{ formatBusinessDate(version.created_at) }}</p>
      </template>
    </SharedDataTable>
  </SharedListPage>
</template>
