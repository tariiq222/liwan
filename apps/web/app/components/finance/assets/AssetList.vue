<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceAsset } from '@webvue/contracts'
import { recordNumberHeader } from '@webvue/ui/app/utils/recordNumberHeader'
import { useFinanceAssetList, useFinanceAssetProfiles } from '@/composables/finance/useFinanceAssets'
import { useRouteListFilters } from '@/composables/useRouteListFilters'
import Money from '../invoices/Money.vue'
import { listReturnTo, useListLocation } from '../invoices/listLocation'
import AssetComputeSection from './AssetComputeSection.vue'
import AssetKpiStrip from './AssetKpiStrip.vue'
import { ASSET_PAGE_SIZE, ASSET_STATES, assetActiveFilterCount, assetFiltersFromQuery, assetListParams } from './assetListParams'
import { ASSETS_PATH, assetRecordPath } from './assetPaths'
import { ASSET_STATE_TONE } from './assetTones'
import type { AssetComputeState } from './useAssetCompute'

// The card of the assets list. The page owns the SharedListPage shell and heading (useAssetListPage).
// `background` is the list behind the create panel: it reads its filters from the panel's returnTo. `compute` is the
// depreciation posting the page's header action opens: drawn above the card, never behind the create panel.
const props = defineProps<{ background?: boolean; compute?: AssetComputeState }>()
const { t } = useI18n()
const { can } = useAccess()
const { shown: kpisShown } = useKpiVisibility()
const allowed = computed(() => can('finance.assets.read'))
const { hydrated, filterQuery, search, update } = useRouteListFilters({
  background: () => props.background,
  fallbackPath: () => ASSETS_PATH,
  safeReturnTo: listReturnTo(ASSETS_PATH),
})
const filters = computed(() => assetFiltersFromQuery(filterQuery.value))
const activeCount = computed(() => assetActiveFilterCount(filters.value))
const query = useFinanceAssetList(() => assetListParams(filters.value), allowed)
const profiles = useFinanceAssetProfiles(allowed)
const items = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / ASSET_PAGE_SIZE)))
const showEmpty = computed(() => !query.isPending.value && !query.error.value && items.value.length === 0)

const listLocation = useListLocation(ASSETS_PATH, props.background)
const recordTo = (asset: FinanceAsset) => ({ path: assetRecordPath(asset.id), query: { returnTo: listLocation.value } })

const stateItems = computed(() => [
  { value: 'all', label: t('financeAssets.filters.allStates') },
  ...ASSET_STATES.map(state => ({ value: state, label: t(`financeAssets.states.${state}`) })),
])
const profileItems = computed(() => [
  { value: 'all', label: t('financeAssets.filters.allProfiles') },
  ...(profiles.data.value?.items ?? []).map(profile => ({ value: String(profile.id), label: profile.name })),
])
function clearFilters() {
  search.value = ''
  void update({ q: undefined, state: undefined, profile_id: undefined, page: undefined })
}
function setChoice(key: 'state' | 'profile_id', value: unknown) {
  void update({ [key]: value === 'all' ? undefined : String(value), page: undefined })
}

const numeric = { class: { th: 'text-end', td: 'text-end' } }
const columns = computed<TableColumn<FinanceAsset>[]>(() => [
  { id: 'record_number', header: () => recordNumberHeader(t), meta: { class: { th: 'w-[48px] min-w-[48px] px-2', td: 'w-[48px] min-w-[48px] px-2' } } },
  { id: 'code', header: t('financeAssets.columns.code') },
  { id: 'name', header: t('financeAssets.columns.name') },
  { id: 'date_start', header: t('financeAssets.columns.dateStart') },
  { id: 'purchase_value', header: t('financeAssets.columns.purchaseValue'), meta: numeric },
  { id: 'value_residual', header: t('financeAssets.columns.valueResidual'), meta: numeric },
  { id: 'state', header: t('financeAssets.columns.state') },
])
const dash = computed(() => t('app.notAvailable'))
</script>

<template>
  <SharedForbiddenState v-if="!allowed" :description="t('financeAssets.forbidden')" />
  <div v-else class="webvue-page-stack">
    <AssetComputeSection v-if="compute" :compute="compute" />
    <AssetKpiStrip v-if="kpisShown" :filters="filters" />
    <SharedListCard>
      <template #filters>
        <SharedFilterBar embedded class="w-full" :active-count="activeCount" :default-open="!!filters.state || !!filters.profileId" :disabled="!hydrated" @clear="clearFilters">
          <template #search>
            <form @submit.prevent="update({ q: search.trim() || undefined, page: undefined })">
              <UInput v-model="search" class="w-full" icon="i-lucide-search" :placeholder="t('financeAssets.filters.search')" :aria-label="t('financeAssets.filters.search')" :disabled="!hydrated" />
            </form>
          </template>
          <SharedFilterField :label="t('financeAssets.filters.state')" for="finance-asset-filter-state">
            <USelect id="finance-asset-filter-state" class="w-full md:w-44" :model-value="filters.state ?? 'all'" :items="stateItems" :disabled="!hydrated" @update:model-value="setChoice('state', $event)" />
          </SharedFilterField>
          <SharedFilterField :label="t('financeAssets.filters.profile')" for="finance-asset-filter-profile">
            <USelect id="finance-asset-filter-profile" class="w-full md:w-56" :model-value="filters.profileId ? String(filters.profileId) : 'all'" :items="profileItems" :disabled="!hydrated" @update:model-value="setChoice('profile_id', $event)" />
          </SharedFilterField>
        </SharedFilterBar>
      </template>
      <SharedPageState :error="query.error.value" :keep-content="items.length > 0" @retry="query.refetch">
        <SharedEmptyState v-if="showEmpty" class="m-(--webvue-card-pad-dense)" :title="t(activeCount ? 'app.noResults' : 'financeAssets.assets.empty')" />
        <div v-else class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,900px)]">
          <SharedDataTable bare :rows="items" :columns="columns" row-key="id" :row-to="recordTo" :loading="query.isPending.value" :caption="t('financeAssets.assets.title')">
            <template #record_number-cell="{ row }"><SharedRecordNumber :value="row.original.id" /></template>
            <template #code-cell="{ row }"><bdi class="tabular-nums">{{ row.original.code || dash }}</bdi></template>
            <template #name-cell="{ row }">
              <NuxtLink :to="recordTo(row.original)" class="font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" :data-testid="`finance-asset-row-${row.original.id}`" @click="!hydrated && $event.preventDefault()">{{ row.original.name }}</NuxtLink>
              <p class="text-sm text-muted">{{ row.original.profile.name }}</p>
            </template>
            <template #date_start-cell="{ row }"><bdi class="tabular-nums">{{ row.original.date_start }}</bdi></template>
            <template #purchase_value-cell="{ row }"><Money :amount="row.original.purchase_value" :currency="row.original.currency" /></template>
            <template #value_residual-cell="{ row }"><Money :amount="row.original.value_residual" :currency="row.original.currency" /></template>
            <template #state-cell="{ row }"><SharedStatusBadge size="sm" :tone="ASSET_STATE_TONE[row.original.state]" :label="t(`financeAssets.states.${row.original.state}`)" /></template>
            <template #mobile-row="{ row }">
              <NuxtLink :to="recordTo(row)" class="flex min-w-0 flex-col gap-2">
                <span class="flex items-center justify-between gap-2">
                  <span class="min-w-0 truncate font-semibold text-highlighted">{{ row.name }}</span>
                  <SharedStatusBadge size="sm" :tone="ASSET_STATE_TONE[row.state]" :label="t(`financeAssets.states.${row.state}`)" />
                </span>
                <span class="truncate text-sm text-muted">{{ row.profile.name }} · <bdi class="tabular-nums">{{ row.code || dash }}</bdi> · <bdi class="tabular-nums">{{ row.date_start }}</bdi></span>
                <span class="flex items-center justify-between gap-2 text-sm">
                  <Money :amount="row.purchase_value" :currency="row.currency" />
                  <span class="text-muted">{{ t('financeAssets.columns.valueResidual') }}: <Money :amount="row.value_residual" :currency="row.currency" /></span>
                </span>
              </NuxtLink>
            </template>
          </SharedDataTable>
        </div>
      </SharedPageState>
      <template v-if="query.data.value && !showEmpty" #footer>
        <SharedListFooter :count-label="t('financeAssets.assets.footer', { shown: items.length, total }, total)" :page="filters.page" :pages="pages" :disabled="!hydrated || query.isFetching.value" count-test-id="finance-asset-count" @update:page="value => update({ page: value > 1 ? String(value) : undefined })" />
      </template>
    </SharedListCard>
  </div>
</template>
