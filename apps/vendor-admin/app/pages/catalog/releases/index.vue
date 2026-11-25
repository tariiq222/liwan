<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { formatBusinessDate } from '@/utils/vendorTime'
import { elapsedSince, type Elapsed } from '@/utils/vendorHealth'
import { lifecycleBadge } from '@/utils/vendorCommercial'
import { catalogDiff, type CatalogDiff } from '@/utils/catalogDiff'
import { currentCatalogVersion, legacyDraft, sellableTiers, type CatalogVersion } from '@/utils/vendorCatalogVersions'
import { useVendorCatalogVersions } from '@/composables/useVendorCatalogVersions'
definePageMeta({ capability: 'vendor.read' })
const { t } = useI18n()
const hydrated = useHydrated()
const { data, error, pending, refresh } = await useVendorCatalogVersions().load()
const items = computed(() => data.value ?? [])
const path = (version: CatalogVersion) => `/catalog/releases/${encodeURIComponent(version.id)}`
// The change a version introduces over the import before it (the next older row; the list is newest first). The table
// hands its cells reactive copies of these items, so the row is located by id, never by object identity.
const diffOf = (version: CatalogVersion): CatalogDiff | null => {
  const index = items.value.findIndex(item => item.id === version.id)
  return index >= 0 && items.value[index + 1] ? catalogDiff(version, items.value[index + 1]) : null
}
// "Now"-based spans wait for hydration: the server does not know the clock the row is read with.
const now = computed(() => (hydrated.value ? new Date() : null))
const span = (value: Elapsed | null) => (value ? t(`vendor.catalog.timeline.span${value.unit === 'minutes' ? 'Minutes' : value.unit === 'hours' ? 'Hours' : 'Days'}`, { count: value.count }, value.count) : '—')
const duration = (version: CatalogVersion) => span(version.published_at ? elapsedSince(version.created_at, new Date(version.published_at)) : now.value ? elapsedSince(version.created_at, now.value) : null)
const age = (version: CatalogVersion) => span(version.published_at && now.value ? elapsedSince(version.published_at, now.value) : null)
const actor = (name: string | null | undefined, labelKey: string) => (name ? t(labelKey, { name }) : null)
const columns = computed<TableColumn<CatalogVersion>[]>(() => [
  { id: 'version', header: t('vendor.catalog.version'), meta: { class: { th: 'min-w-32', td: 'min-w-32' } } },
  { id: 'status', header: t('vendor.common.status'), meta: { class: { th: 'w-36', td: 'w-36 whitespace-nowrap' } } },
  { id: 'imported', header: t('vendor.catalog.timeline.importer'), meta: { class: { th: 'w-44', td: 'w-44 whitespace-nowrap' } } },
  { id: 'published', header: t('vendor.catalog.timeline.published'), meta: { class: { th: 'w-44', td: 'w-44 whitespace-nowrap' } } },
  { id: 'duration', header: t('vendor.catalog.timeline.duration'), meta: { class: { th: 'w-28', td: 'w-28 whitespace-nowrap' } } },
  { id: 'age', header: t('vendor.catalog.timeline.age'), meta: { class: { th: 'w-28', td: 'w-28 whitespace-nowrap' } } },
  { id: 'changes', header: t('vendor.catalog.timeline.changes'), meta: { class: { th: 'min-w-56', td: 'min-w-56' } } },
])
</script>
<template>
  <SharedListPage :title="t('vendor.catalog.releases')">
    <template #filters><VendorCatalogTabs class="mb-3" /></template>
    <VendorCatalogGlossary class="mb-4" />
    <SharedDataTable :rows="items" :columns="columns" row-key="id" :row-to="path" :loading="pending" :error="error" :empty-text="t('vendor.catalog.empty')" :caption="t('vendor.catalog.releases')" @retry="refresh">
      <template #version-cell="{ row: { original: version } }">
        <span class="flex flex-col">
          <NuxtLink :to="path(version)" data-testid="catalog-row" class="font-medium tabular-nums hover:underline" dir="ltr">{{ version.version }}</NuxtLink>
          <span class="mt-0.5 text-sm text-muted">{{ formatBusinessDate(version.created_at) }}</span>
        </span>
      </template>
      <template #status-cell="{ row: { original: version } }"><SharedStatusBadge :tone="lifecycleBadge(version).tone" :label="t(lifecycleBadge(version).labelKey)" /></template>
      <template #imported-cell="{ row: { original: version } }">
        <span v-if="actor(version.imported_by, 'vendor.catalog.timeline.importedBy')">{{ actor(version.imported_by, 'vendor.catalog.timeline.importedBy') }}</span>
        <span v-else class="text-muted">—</span>
      </template>
      <template #published-cell="{ row: { original: version } }">
        <template v-if="version.published_at">
          <span>{{ formatBusinessDate(version.published_at) }}</span>
          <span v-if="actor(version.published_by, 'vendor.catalog.timeline.publishedBy')" class="block text-sm text-muted">{{ actor(version.published_by, 'vendor.catalog.timeline.publishedBy') }}</span>
        </template>
        <NuxtLink v-else-if="version.status === 'validated'" :to="path(version)" data-testid="catalog-approve" class="font-medium text-primary hover:underline">{{ t('vendor.catalog.timeline.approve') }}</NuxtLink>
        <span v-else-if="legacyDraft(version.status)" class="text-sm text-muted" data-testid="catalog-legacy-draft">{{ t('vendor.catalog.legacyDraft') }}</span>
      </template>
      <template #duration-cell="{ row: { original: version } }"><span class="tabular-nums">{{ duration(version) }}</span></template>
      <template #age-cell="{ row: { original: version } }"><span class="tabular-nums" :class="{ 'text-muted': !version.published_at }">{{ age(version) }}</span></template>
      <template #changes-cell="{ row: { original: version } }"><VendorCatalogDiffChips :diff="diffOf(version)" /></template>
      <template #mobile-row="{ row: version }">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <h2 class="text-lg font-semibold"><NuxtLink :to="path(version)" data-testid="catalog-row" dir="ltr">{{ version.version }}</NuxtLink></h2>
          <SharedStatusBadge :tone="lifecycleBadge(version).tone" :label="t(lifecycleBadge(version).labelKey)" />
        </div>
        <p class="mt-3 text-sm text-muted">{{ t('vendor.catalog.imported') }}: {{ formatBusinessDate(version.created_at) }}<template v-if="version.imported_by"> · {{ actor(version.imported_by, 'vendor.catalog.timeline.importedBy') }}</template></p>
        <p v-if="version.published_at" class="text-sm text-muted">{{ t('vendor.catalog.timeline.published') }}: {{ formatBusinessDate(version.published_at) }}<template v-if="version.published_by"> · {{ actor(version.published_by, 'vendor.catalog.timeline.publishedBy') }}</template></p>
        <p v-else-if="version.status === 'validated'" class="mt-1 text-sm"><NuxtLink :to="path(version)" data-testid="catalog-approve" class="font-medium text-primary hover:underline">{{ t('vendor.catalog.timeline.approve') }}</NuxtLink></p>
        <p v-else-if="legacyDraft(version.status)" class="mt-1 text-sm text-muted" data-testid="catalog-legacy-draft">{{ t('vendor.catalog.legacyDraft') }}</p>
        <p class="mt-3 text-sm text-muted">{{ t('vendor.catalog.timeline.duration') }}: <span class="tabular-nums">{{ duration(version) }}</span><template v-if="version.published_at"> · {{ t('vendor.catalog.timeline.age') }}: <span class="tabular-nums">{{ age(version) }}</span></template></p>
        <div class="mt-3"><VendorCatalogDiffChips :diff="diffOf(version)" /></div>
      </template>
    </SharedDataTable>
  </SharedListPage>
</template>
