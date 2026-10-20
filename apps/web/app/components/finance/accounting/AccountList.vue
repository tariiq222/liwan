<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceAccount } from '@webvue/contracts'
import { useFinanceAccountList } from '@/composables/finance/useFinanceAccounts'
import { useRouteListFilters } from '@/composables/useRouteListFilters'
import { listReturnTo } from '../invoices/listLocation'
import { ACCOUNT_PAGE_SIZE, ACCOUNT_TYPES, accountActiveFilterCount, accountFiltersFromQuery, accountListParams } from './accountListParams'
import { ACCOUNTS_PATH } from './entryPaths'

// The card of the chart of accounts: a read view. The page owns the SharedListPage shell and heading (useAccountListPage).
const { t } = useI18n()
const { can } = useAccess()
const allowed = computed(() => can('finance.accounts.read'))
const { hydrated, filterQuery, search, update } = useRouteListFilters({
  fallbackPath: () => ACCOUNTS_PATH,
  safeReturnTo: listReturnTo(ACCOUNTS_PATH),
})
const filters = computed(() => accountFiltersFromQuery(filterQuery.value))
const activeCount = computed(() => accountActiveFilterCount(filters.value))
const query = useFinanceAccountList(() => accountListParams(filters.value), allowed)
const items = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / ACCOUNT_PAGE_SIZE)))
const showEmpty = computed(() => !query.isPending.value && !query.error.value && items.value.length === 0)

const typeItems = computed(() => [
  { value: 'all', label: t('financeAccounting.filters.allTypes') },
  ...ACCOUNT_TYPES.map(type => ({ value: type, label: t(`financeAccounting.accountTypes.${type}`) })),
])
function clearFilters() {
  search.value = ''
  void update({ q: undefined, account_type: undefined, page: undefined })
}
function setType(value: unknown) {
  void update({ account_type: value === 'all' ? undefined : String(value), page: undefined })
}

const columns = computed<TableColumn<FinanceAccount>[]>(() => [
  { id: 'code', header: t('financeAccounting.columns.code') },
  { id: 'name', header: t('financeAccounting.columns.accountName') },
  { id: 'account_type', header: t('financeAccounting.columns.type') },
  { id: 'reconcile', header: t('financeAccounting.columns.reconcile') },
  { id: 'currency', header: t('financeAccounting.columns.currency') },
])
const dash = computed(() => t('app.notAvailable'))
const reconcileLabel = (account: FinanceAccount) => t(account.reconcile ? 'financeAccounting.accounts.reconcileYes' : 'financeAccounting.accounts.reconcileNo')
</script>

<template>
  <SharedForbiddenState v-if="!allowed" :description="t('financeAccounting.forbidden')" />
  <div v-else class="webvue-page-stack">
    <SharedListCard>
      <template #filters>
        <SharedFilterBar embedded class="w-full" :active-count="activeCount" :default-open="!!filters.accountType" :disabled="!hydrated" @clear="clearFilters">
          <template #search>
            <form @submit.prevent="update({ q: search.trim() || undefined, page: undefined })">
              <UInput v-model="search" class="w-full" icon="i-lucide-search" :placeholder="t('financeAccounting.filters.searchAccounts')" :aria-label="t('financeAccounting.filters.searchAccounts')" :disabled="!hydrated" />
            </form>
          </template>
          <SharedFilterField :label="t('financeAccounting.filters.accountType')" for="finance-account-filter-type">
            <USelect id="finance-account-filter-type" class="w-full md:w-64" :model-value="filters.accountType ?? 'all'" :items="typeItems" :disabled="!hydrated" @update:model-value="setType" />
          </SharedFilterField>
        </SharedFilterBar>
      </template>
      <SharedPageState :error="query.error.value" :keep-content="items.length > 0" @retry="query.refetch">
        <SharedEmptyState v-if="showEmpty" class="m-(--webvue-card-pad-dense)" :title="t(activeCount ? 'app.noResults' : 'financeAccounting.accounts.empty')" />
        <div v-else class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,720px)]">
          <SharedDataTable bare :rows="items" :columns="columns" row-key="id" :loading="query.isPending.value" :caption="t('financeAccounting.accounts.title')">
            <template #code-cell="{ row }"><bdi class="font-semibold tabular-nums text-highlighted" dir="ltr">{{ row.original.code }}</bdi></template>
            <template #name-cell="{ row }">{{ row.original.name }}</template>
            <template #account_type-cell="{ row }"><SharedStatusBadge size="sm" tone="neutral" :label="t(`financeAccounting.accountTypes.${row.original.account_type}`)" /></template>
            <template #reconcile-cell="{ row }">{{ reconcileLabel(row.original) }}</template>
            <template #currency-cell="{ row }">{{ row.original.currency ?? dash }}</template>
            <template #mobile-row="{ row }">
              <div class="flex min-w-0 flex-col gap-2">
                <span class="flex items-center justify-between gap-2">
                  <span class="min-w-0 truncate font-semibold text-highlighted"><bdi dir="ltr" class="tabular-nums">{{ row.code }}</bdi> {{ row.name }}</span>
                  <SharedStatusBadge size="sm" tone="neutral" :label="t(`financeAccounting.accountTypes.${row.account_type}`)" />
                </span>
                <span class="text-sm text-muted">{{ reconcileLabel(row) }} · {{ row.currency ?? dash }}</span>
              </div>
            </template>
          </SharedDataTable>
        </div>
      </SharedPageState>
      <template v-if="query.data.value && !showEmpty" #footer>
        <SharedListFooter :count-label="t('financeAccounting.accounts.footer', { shown: items.length, total }, total)" :page="filters.page" :pages="pages" :disabled="!hydrated || query.isFetching.value" count-test-id="finance-account-count" @update:page="value => update({ page: value > 1 ? String(value) : undefined })" />
      </template>
    </SharedListCard>
  </div>
</template>
