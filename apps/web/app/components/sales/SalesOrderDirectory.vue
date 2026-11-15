<script setup lang="ts">
import type { SalesOrderListItem } from '@liwan/contracts'
import { SALES_LIST_PATH, SALES_LIST_KEYS, SALES_PAGE_SIZE, SALES_STAGES, parseSalesListQuery } from '@/composables/sales/salesListParams'
import { useSalesOrders } from '@/composables/sales/useSalesOrders'
import { listLocation, safeListReturnTo, useLastPageClamp, useRouteListFilters } from '@/composables/useRouteListFilters'
import SalesOrderTable from './SalesOrderTable.vue'

// The body of the sales page: the filter bar (search by number or customer, the source, "mine only" and the stage),
// then the table in one card with its pager. The filters live in the URL query, so a record and the browser's Back
// return to the same list. `background` is the list behind the create panel: it reads its filters from the panel's
// returnTo. The page owns the SharedListPage shell.
const props = defineProps<{ background?: boolean }>()
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const { hydrated, filterQuery, search, update } = useRouteListFilters({ background: () => props.background, fallbackPath: () => SALES_LIST_PATH, safeReturnTo: value => safeListReturnTo(SALES_LIST_PATH, value) })

const state = computed(() => parseSalesListQuery(filterQuery.value))
const query = useSalesOrders(state)
const items = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / SALES_PAGE_SIZE)))
useLastPageClamp({ page: () => state.value.page, total: () => query.data.value?.total, pageSize: SALES_PAGE_SIZE })
const activeCount = computed(() => Number(Boolean(state.value.q)) + Number(state.value.source !== null) + Number(state.value.mine))
const backTo = computed(() => listLocation(SALES_LIST_PATH, SALES_LIST_KEYS, filterQuery.value, route.hash))
const recordTo = (order: SalesOrderListItem) => ({ path: `${SALES_LIST_PATH}/${order.id}`, query: { returnTo: backTo.value } })

const ANY_SOURCE = 'any'
const stages = computed(() => SALES_STAGES.map(value => ({ value, label: t(`sales.stage.${value}`) })))
const sourceItems = computed(() => [
  { value: ANY_SOURCE, label: t('sales.source.any') },
  { value: 'staff', label: t('sales.source.staff') },
  { value: 'online', label: t('sales.source.online') },
])
function setStage(value: string | number) { void update({ state: value === 'all' ? undefined : String(value), page: undefined }) }
function setSource(value: unknown) { void update({ source: value === ANY_SOURCE ? undefined : String(value), page: undefined }) }
function setMine(value: boolean | 'indeterminate') { void update({ mine: value === true ? '1' : undefined, page: undefined }) }
function clearFilters() { search.value = ''; void update({ q: undefined, source: undefined, mine: undefined, page: undefined }) }
const emptyText = computed(() => t(activeCount.value || state.value.stage !== 'all' ? 'app.noResults' : 'sales.empty'))
</script>

<template>
  <SharedForbiddenState v-if="!can('sales.read')" />
  <div v-else class="flex min-w-0 flex-col gap-4">
    <SharedListCard>
      <template #filters>
        <SharedFilterBar embedded class="w-full" :active-count="activeCount" :disabled="!hydrated" @clear="clearFilters">
          <template #search>
            <form @submit.prevent="update({ q: search.trim() || undefined, page: undefined })">
              <UInput v-model="search" class="w-full" icon="i-lucide-search" :placeholder="t('sales.search')" :aria-label="t('sales.search')" :disabled="!hydrated" data-testid="sales-search" />
            </form>
          </template>
          <USelect :model-value="state.source ?? ANY_SOURCE" :items="sourceItems" :aria-label="t('sales.columns.source')" :disabled="!hydrated" data-testid="sales-source" @update:model-value="setSource" />
          <UCheckbox :model-value="state.mine" :label="t('sales.mine')" :disabled="!hydrated" data-testid="sales-mine" @update:model-value="setMine" />
          <template #view>
            <SharedSegmentedControl data-testid="sales-stage" :label="t('sales.stage.label')" :items="stages" :model-value="state.stage" @update:model-value="setStage" />
          </template>
        </SharedFilterBar>
      </template>
      <SharedPageState v-if="query.error.value && !query.data.value" :error="query.error.value" @retry="query.refetch()" />
      <SharedEmptyState v-else-if="!query.isPending.value && !items.length" class="m-(--liwan-card-pad-dense)" :title="emptyText">
        <template v-if="activeCount" #action><UButton color="neutral" variant="outline" size="sm" :disabled="!hydrated" :label="t('sales.clear')" @click="clearFilters" /></template>
      </SharedEmptyState>
      <SalesOrderTable v-else :rows="items" :loading="query.isPending.value" :error="null" :record-to="recordTo" @retry="query.refetch()" />
      <template v-if="query.data.value && items.length" #footer>
        <SharedListFooter :count-label="t('sales.footer', { shown: items.length, total }, total)" :page="state.page" :pages="pages" :disabled="!hydrated || query.isFetching.value" @update:page="value => update({ page: value > 1 ? String(value) : undefined })" />
      </template>
    </SharedListCard>
  </div>
</template>
