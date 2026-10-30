<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceBudget } from '@liwan/contracts'
import { recordNumberHeader } from '@liwan/ui/app/utils/recordNumberHeader'
import { useFinanceBudgetList } from '@/composables/finance/useFinanceBudgets'
import { useRouteListFilters } from '@/composables/useRouteListFilters'
import { listReturnTo, useListLocation } from '../invoices/listLocation'
import BudgetKpiStrip from './BudgetKpiStrip.vue'
import { BUDGET_PAGE_SIZE, BUDGET_STATES, budgetActiveFilterCount, budgetFiltersFromQuery, budgetListParams } from './budgetListParams'
import { BUDGETS_PATH, budgetPeriod, budgetRecordPath } from './budgetPaths'
import { BUDGET_STATE_TONE } from './budgetTones'

// The card of the budgets list. The page owns the SharedListPage shell and heading (useBudgetListPage).
// `background` is the list behind the create panel: it reads its filters from the panel's returnTo.
const props = defineProps<{ background?: boolean }>()
const { t } = useI18n()
const { can } = useAccess()
const { shown: kpisShown } = useKpiVisibility()
const allowed = computed(() => can('finance.budgets.read'))
const { hydrated, filterQuery, search, update } = useRouteListFilters({
  background: () => props.background,
  fallbackPath: () => BUDGETS_PATH,
  safeReturnTo: listReturnTo(BUDGETS_PATH),
})
const filters = computed(() => budgetFiltersFromQuery(filterQuery.value))
const activeCount = computed(() => budgetActiveFilterCount(filters.value))
const query = useFinanceBudgetList(() => budgetListParams(filters.value), allowed)
const items = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / BUDGET_PAGE_SIZE)))
const showEmpty = computed(() => !query.isPending.value && !query.error.value && items.value.length === 0)

const listLocation = useListLocation(BUDGETS_PATH, props.background)
const recordTo = (budget: FinanceBudget) => ({ path: budgetRecordPath(budget.id), query: { returnTo: listLocation.value } })

const stateItems = computed(() => [
  { value: 'all', label: t('financeBudgets.filters.allStates') },
  ...BUDGET_STATES.map(state => ({ value: state, label: t(`financeBudgets.states.${state}`) })),
])
function clearFilters() {
  search.value = ''
  void update({ q: undefined, state: undefined, page: undefined })
}
function setState(value: unknown) {
  void update({ state: value === 'all' ? undefined : String(value), page: undefined })
}

const columns = computed<TableColumn<FinanceBudget>[]>(() => [
  { id: 'record_number', header: () => recordNumberHeader(t), meta: { class: { th: 'w-[48px] min-w-[48px] px-2', td: 'w-[48px] min-w-[48px] px-2' } } },
  { id: 'name', header: t('financeBudgets.columns.name') },
  { id: 'period', header: t('financeBudgets.columns.period') },
  { id: 'line_count', header: t('financeBudgets.columns.lineCount') },
  { id: 'state', header: t('financeBudgets.columns.state') },
])
const lineCount = (budget: FinanceBudget) => t('financeBudgets.lines.count', { count: budget.line_count }, budget.line_count)
</script>

<template>
  <SharedForbiddenState v-if="!allowed" :description="t('financeBudgets.forbidden')" />
  <div v-else class="liwan-page-stack">
    <BudgetKpiStrip v-if="kpisShown" :filters="filters" />
    <SharedListCard>
      <template #filters>
        <SharedFilterBar embedded class="w-full" :active-count="activeCount" :default-open="!!filters.state" :disabled="!hydrated" @clear="clearFilters">
          <template #search>
            <form @submit.prevent="update({ q: search.trim() || undefined, page: undefined })">
              <UInput v-model="search" class="w-full" icon="i-lucide-search" :placeholder="t('financeBudgets.filters.search')" :aria-label="t('financeBudgets.filters.search')" :disabled="!hydrated" />
            </form>
          </template>
          <SharedFilterField :label="t('financeBudgets.filters.state')" for="finance-budget-filter-state">
            <USelect id="finance-budget-filter-state" class="w-full md:w-44" :model-value="filters.state ?? 'all'" :items="stateItems" :disabled="!hydrated" @update:model-value="setState($event)" />
          </SharedFilterField>
        </SharedFilterBar>
      </template>
      <SharedPageState :error="query.error.value" :keep-content="items.length > 0" @retry="query.refetch">
        <SharedEmptyState v-if="showEmpty" class="m-(--liwan-card-pad-dense)" :title="t(activeCount ? 'app.noResults' : 'financeBudgets.budgets.empty')" />
        <div v-else class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,720px)]">
          <SharedDataTable bare :rows="items" :columns="columns" row-key="id" :row-to="recordTo" :loading="query.isPending.value" :caption="t('financeBudgets.budgets.title')">
            <template #record_number-cell="{ row }"><SharedRecordNumber :value="row.original.id" /></template>
            <template #name-cell="{ row }">
              <NuxtLink :to="recordTo(row.original)" class="font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" :data-testid="`finance-budget-row-${row.original.id}`" @click="!hydrated && $event.preventDefault()">{{ row.original.name }}</NuxtLink>
            </template>
            <template #period-cell="{ row }"><bdi class="tabular-nums">{{ budgetPeriod(row.original) }}</bdi></template>
            <template #line_count-cell="{ row }">{{ lineCount(row.original) }}</template>
            <template #state-cell="{ row }"><SharedStatusBadge size="sm" :tone="BUDGET_STATE_TONE[row.original.state]" :label="t(`financeBudgets.states.${row.original.state}`)" /></template>
            <template #mobile-row="{ row }">
              <NuxtLink :to="recordTo(row)" class="flex min-w-0 flex-col gap-2">
                <span class="flex items-center justify-between gap-2">
                  <span class="min-w-0 truncate font-semibold text-highlighted">{{ row.name }}</span>
                  <SharedStatusBadge size="sm" :tone="BUDGET_STATE_TONE[row.state]" :label="t(`financeBudgets.states.${row.state}`)" />
                </span>
                <span class="flex items-center justify-between gap-2 text-sm text-muted">
                  <bdi class="tabular-nums">{{ budgetPeriod(row) }}</bdi>
                  <span>{{ lineCount(row) }}</span>
                </span>
              </NuxtLink>
            </template>
          </SharedDataTable>
        </div>
      </SharedPageState>
      <template v-if="query.data.value && !showEmpty" #footer>
        <SharedListFooter :count-label="t('financeBudgets.budgets.footer', { shown: items.length, total }, total)" :page="filters.page" :pages="pages" :disabled="!hydrated || query.isFetching.value" count-test-id="finance-budget-count" @update:page="value => update({ page: value > 1 ? String(value) : undefined })" />
      </template>
    </SharedListCard>
  </div>
</template>
