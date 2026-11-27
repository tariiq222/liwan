<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceAnalyticAccount } from '@liwan/contracts'
import type { RowAction } from '@liwan/ui/app/components/shared/data/RowActions.vue'
import { returnToQuery, safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import { h } from 'vue'
import { useFinanceAnalyticAccounts, useFinanceAnalyticPlans } from '@/composables/finance/useFinanceAnalytic'
import { useRouteListFilters } from '@/composables/useRouteListFilters'
import AnalyticArchiveConfirm from './AnalyticArchiveConfirm.vue'
import { ANALYTIC_PAGE_SIZE, analyticAccountParams, analyticActiveFilterCount, analyticFiltersFromQuery } from './analyticParams'

// The cost centers of the current company: search, plan and archived filters in the URL, a page of cost centers, and the
// inline archive confirmation above the list card. There is no delete; an archived cost center can be brought back.
const props = defineProps<{ background?: boolean }>()
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const { hydrated, filterQuery, search, update } = useRouteListFilters({
  background: () => props.background,
  fallbackPath: () => '/settings/apps/finance',
  safeReturnTo: (value, fallback) => safeReturnTo(value, fallback, ['/settings/apps/finance']),
})
const canManage = computed(() => can('finance.analytic.manage'))
const filters = computed(() => analyticFiltersFromQuery(filterQuery.value))
const activeCount = computed(() => analyticActiveFilterCount(filters.value))
const query = useFinanceAnalyticAccounts(() => analyticAccountParams(filters.value))
const plans = useFinanceAnalyticPlans()
const planList = computed(() => plans.data.value?.items ?? [])
const items = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / ANALYTIC_PAGE_SIZE)))
const showEmpty = computed(() => !query.isPending.value && !query.error.value && items.value.length === 0)

const archivingAccount = ref<FinanceAnalyticAccount | null>(null)

const planItems = computed(() => [{ value: 'all', label: t('financeAnalytic.filters.allPlans') }, ...planList.value.map(plan => ({ value: String(plan.id), label: plan.name }))])
const stateItems = computed(() => (['active', 'archived'] as const).map(value => ({ value, label: t(`financeAnalytic.states.${value}`) })))
function clearFilters() {
  search.value = ''
  void update({ q: undefined, plan_id: undefined, archived: undefined, page: undefined })
}
const setPlan = (value: unknown) => update({ plan_id: value === 'all' ? undefined : String(value), page: undefined })
const setState = (value: unknown) => update({ archived: value === 'archived' ? 'true' : undefined, page: undefined })

const columns = computed<TableColumn<FinanceAnalyticAccount>[]>(() => [
  { id: 'code', header: t('financeAnalytic.accounts.columns.code') },
  { id: 'name', header: t('financeAnalytic.accounts.columns.name') },
  { id: 'plan', header: t('financeAnalytic.accounts.columns.plan') },
  { id: 'state', header: t('financeAnalytic.accounts.columns.state') },
  ...(canManage.value ? [{ id: 'actions', header: () => h('span', { class: 'sr-only' }, t('app.actions')), meta: { class: { th: 'w-0', td: 'w-0 text-end' } } }] : []),
])
const dash = computed(() => t('app.notAvailable'))
const stateTone = (account: FinanceAnalyticAccount) => account.active ? 'success' : 'neutral'
const stateLabel = (account: FinanceAnalyticAccount) => t(`financeAnalytic.states.${account.active ? 'active' : 'archived'}`)
const accountActions = (account: FinanceAnalyticAccount): RowAction[] => [
  {
    label: t('financeAnalytic.accounts.actions.edit'),
    icon: 'i-lucide-pencil',
    to: { path: `/settings/apps/finance/analytic-accounts/${account.id}/edit`, query: returnToQuery(route.fullPath) },
  },
  account.active
    ? { label: t('financeAnalytic.accounts.actions.archive'), icon: 'i-lucide-archive', onSelect: () => { archivingAccount.value = account } }
    : { label: t('financeAnalytic.accounts.actions.unarchive'), icon: 'i-lucide-archive-restore', onSelect: () => { archivingAccount.value = account } },
]
</script>

<template>
  <SharedRecordSection variant="flat" :title="t('financeAnalytic.accounts.title')" :description="t('financeAnalytic.accounts.description')" data-testid="finance-analytic-accounts">
    <template v-if="canManage" #actions>
      <UButton
        :to="{ path: '/settings/apps/finance/analytic-accounts/new', query: returnToQuery(route.fullPath) }"
        icon="i-lucide-plus"
        :disabled="!hydrated || planList.length === 0"
        :label="t('financeAnalytic.accounts.new')"
        data-testid="finance-analytic-account-new"
      />
    </template>
    <AnalyticArchiveConfirm
      v-if="archivingAccount"
      :key="archivingAccount.id"
      :account="archivingAccount"
      @done="archivingAccount = null"
      @cancel="archivingAccount = null"
    />
    <SharedListCard>
      <template #filters>
        <SharedFilterBar embedded class="w-full" :active-count="activeCount" :default-open="!!filters.planId || filters.archived" :disabled="!hydrated" @clear="clearFilters">
          <template #search>
            <form @submit.prevent="update({ q: search.trim() || undefined, page: undefined })">
              <UInput v-model="search" class="w-full" icon="i-lucide-search" :placeholder="t('financeAnalytic.filters.search')" :aria-label="t('financeAnalytic.filters.search')" :disabled="!hydrated" />
            </form>
          </template>
          <SharedFilterField :label="t('financeAnalytic.filters.plan')" for="finance-analytic-filter-plan">
            <USelect id="finance-analytic-filter-plan" class="w-full md:w-48" :model-value="filters.planId ? String(filters.planId) : 'all'" :items="planItems" :disabled="!hydrated" @update:model-value="setPlan" />
          </SharedFilterField>
          <SharedFilterField :label="t('financeAnalytic.filters.state')" for="finance-analytic-filter-state">
            <USelect id="finance-analytic-filter-state" class="w-full md:w-40" :model-value="filters.archived ? 'archived' : 'active'" :items="stateItems" :disabled="!hydrated" @update:model-value="setState" />
          </SharedFilterField>
        </SharedFilterBar>
      </template>
      <SharedPageState :error="query.error.value" :keep-content="items.length > 0" @retry="query.refetch">
        <SharedEmptyState v-if="showEmpty" class="m-(--liwan-card-pad-dense)" :icon="activeCount ? 'i-lucide-filter-x' : 'i-lucide-chart-pie'" :title="t(activeCount ? 'app.noResults' : 'financeAnalytic.accounts.empty')" />
        <div v-else class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,640px)]">
          <SharedDataTable bare :rows="items" :columns="columns" row-key="id" :loading="query.isPending.value" :caption="t('financeAnalytic.accounts.title')">
            <template #code-cell="{ row }"><bdi class="tabular-nums">{{ row.original.code || dash }}</bdi></template>
            <template #name-cell="{ row }"><span class="font-semibold text-highlighted">{{ row.original.name }}</span></template>
            <template #plan-cell="{ row }">{{ row.original.plan.name }}</template>
            <template #state-cell="{ row }"><SharedStatusBadge size="sm" :tone="stateTone(row.original)" :label="stateLabel(row.original)" /></template>
            <template #actions-cell="{ row }">
              <SharedRowActions :actions="accountActions(row.original)" :label="t('financeAnalytic.accounts.actionsNamed', { name: row.original.name })" :disabled="!hydrated || archivingAccount !== null" />
            </template>
            <template #mobile-row="{ row }">
              <div class="flex min-w-0 items-start justify-between gap-2" :data-testid="`finance-analytic-account-${row.id}`">
                <div class="flex min-w-0 flex-col gap-1">
                  <span class="truncate font-semibold text-highlighted">{{ row.name }}</span>
                  <span class="truncate text-sm text-muted"><bdi class="tabular-nums">{{ row.code || dash }}</bdi> · {{ row.plan.name }}</span>
                  <SharedStatusBadge size="sm" class="w-fit" :tone="stateTone(row)" :label="stateLabel(row)" />
                </div>
                <SharedRowActions v-if="canManage" :actions="accountActions(row)" :label="t('financeAnalytic.accounts.actionsNamed', { name: row.name })" :disabled="!hydrated || archivingAccount !== null" />
              </div>
            </template>
          </SharedDataTable>
        </div>
      </SharedPageState>
      <template v-if="query.data.value && !showEmpty" #footer>
        <SharedListFooter :count-label="t('financeAnalytic.accounts.footer', { shown: items.length, total }, total)" :page="filters.page" :pages="pages" :disabled="!hydrated || query.isFetching.value" count-test-id="finance-analytic-account-count" @update:page="value => update({ page: value > 1 ? String(value) : undefined })" />
      </template>
    </SharedListCard>
  </SharedRecordSection>
</template>
