<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceBankStatement } from '@webvue/contracts'
import { recordNumberHeader } from '@webvue/ui/app/utils/recordNumberHeader'
import { useFinanceBankJournals, useFinanceBankStatements } from '@/composables/finance/useFinanceBank'
import { useRouteListFilters } from '@/composables/useRouteListFilters'
import { listReturnTo, useListLocation } from '../invoices/listLocation'
import Money from '../invoices/Money.vue'
import BankKpiStrip from './BankKpiStrip.vue'
import { BANK_PAGE_SIZE, bankActiveFilterCount, bankFiltersFromQuery, bankListParams } from './bankListParams'
import { BANK_STATEMENTS_PATH, hasEndDifference, statementPath } from './bankModel'

// The card of the statements list; the page owns the SharedListPage shell and heading (useBankListPage). `background`
// is the list behind the create panel: it reads its filters from the panel's returnTo.
const props = defineProps<{ background?: boolean }>()
const { t } = useI18n()
const { can } = useAccess()
const { shown: kpisShown } = useKpiVisibility()
const allowed = computed(() => can('finance.bank.read'))
const { hydrated, filterQuery, update } = useRouteListFilters({
  background: () => props.background,
  fallbackPath: () => BANK_STATEMENTS_PATH,
  safeReturnTo: listReturnTo(BANK_STATEMENTS_PATH),
})
const filters = computed(() => bankFiltersFromQuery(filterQuery.value))
const activeCount = computed(() => bankActiveFilterCount(filters.value))
const route = useRoute()
const importTo = computed(() => can('finance.bank.manage') && !props.background ? { path: `${BANK_STATEMENTS_PATH}/new`, query: { kind: 'import', returnTo: route.fullPath } } : undefined)
const query = useFinanceBankStatements(() => bankListParams(filters.value), allowed)
const journals = useFinanceBankJournals(allowed)
const items = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / BANK_PAGE_SIZE)))
const showEmpty = computed(() => !query.isPending.value && !query.error.value && items.value.length === 0)

const listLocation = useListLocation(BANK_STATEMENTS_PATH, props.background)
const recordTo = (statement: FinanceBankStatement) => ({ path: statementPath(statement.id), query: { returnTo: listLocation.value } })

const journalItems = computed(() => [
  { value: 'all', label: t('financeBank.filters.allJournals') },
  ...(journals.data.value?.items ?? []).map(journal => ({ value: String(journal.id), label: journal.name })),
])
function clearFilters() {
  void update({ journal_id: undefined, date_from: undefined, date_to: undefined, page: undefined })
}
function setJournal(value: unknown) {
  void update({ journal_id: value === 'all' ? undefined : String(value), page: undefined })
}
function setDate(key: 'date_from' | 'date_to', value: string | null) {
  void update({ [key]: value ?? undefined, page: undefined })
}

const end = { class: { th: 'text-end', td: 'text-end' } }
const columns = computed<TableColumn<FinanceBankStatement>[]>(() => [
  { id: 'record_number', header: () => recordNumberHeader(t), meta: { class: { th: 'w-[48px] min-w-[48px] px-2', td: 'w-[48px] min-w-[48px] px-2' } } },
  { id: 'name', header: t('financeBank.columns.name') },
  { id: 'date', header: t('financeBank.columns.date') },
  { id: 'journal', header: t('financeBank.columns.journal') },
  { id: 'balance_start', header: t('financeBank.columns.balanceStart'), meta: end },
  { id: 'balance_end_real', header: t('financeBank.columns.balanceEnd'), meta: end },
  { id: 'lines_count', header: t('financeBank.columns.linesCount'), meta: end },
  { id: 'difference', header: t('financeBank.columns.difference') },
])
const dash = computed(() => t('app.notAvailable'))
</script>

<template>
  <SharedForbiddenState v-if="!allowed" :description="t('financeBank.forbidden')" />
  <div v-else class="webvue-page-stack">
    <BankKpiStrip v-if="kpisShown" :filters="filters" :filtered="activeCount > 0" />
    <div v-if="importTo" class="flex justify-end">
      <UButton color="neutral" variant="outline" icon="i-lucide-file-up" :to="importTo" :label="t('financeBank.import.link')" data-testid="finance-bank-import-link" />
    </div>
    <SharedListCard>
      <template #filters>
        <SharedFilterBar embedded class="w-full" :active-count="activeCount" :default-open="activeCount > 0" :disabled="!hydrated" @clear="clearFilters">
          <SharedFilterField :label="t('financeBank.filters.journal')" for="finance-bank-filter-journal">
            <USelect id="finance-bank-filter-journal" class="w-full md:w-56" :model-value="filters.journalId ? String(filters.journalId) : 'all'" :items="journalItems" :loading="journals.isFetching.value" :disabled="!hydrated" @update:model-value="setJournal" />
          </SharedFilterField>
          <SharedFilterField :label="t('financeBank.filters.dateFrom')" for="finance-bank-filter-from">
            <SharedDateField id="finance-bank-filter-from" :model-value="filters.dateFrom" :max-value="filters.dateTo" :disabled="!hydrated" @update:model-value="setDate('date_from', $event)" />
          </SharedFilterField>
          <SharedFilterField :label="t('financeBank.filters.dateTo')" for="finance-bank-filter-to">
            <SharedDateField id="finance-bank-filter-to" :model-value="filters.dateTo" :min-value="filters.dateFrom" :disabled="!hydrated" @update:model-value="setDate('date_to', $event)" />
          </SharedFilterField>
        </SharedFilterBar>
      </template>
      <SharedPageState :error="query.error.value" :keep-content="items.length > 0" @retry="query.refetch">
        <SharedEmptyState v-if="showEmpty" class="m-(--webvue-card-pad-dense)" :title="t(activeCount ? 'app.noResults' : 'financeBank.empty')" />
        <div v-else class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,900px)]">
          <SharedDataTable bare :rows="items" :columns="columns" row-key="id" :row-to="recordTo" :loading="query.isPending.value" :caption="t('financeBank.title')">
            <template #record_number-cell="{ row }"><SharedRecordNumber :value="row.original.id" /></template>
            <template #name-cell="{ row }">
              <NuxtLink :to="recordTo(row.original)" class="font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" :data-testid="`finance-bank-row-${row.original.id}`" @click="!hydrated && $event.preventDefault()"><bdi>{{ row.original.name }}</bdi></NuxtLink>
            </template>
            <template #date-cell="{ row }"><bdi class="tabular-nums">{{ row.original.date ?? dash }}</bdi></template>
            <template #journal-cell="{ row }">{{ row.original.journal.name }}</template>
            <template #balance_start-cell="{ row }"><Money :amount="row.original.balance_start" :currency="row.original.currency" /></template>
            <template #balance_end_real-cell="{ row }"><Money :amount="row.original.balance_end_real" :currency="row.original.currency" /></template>
            <template #lines_count-cell="{ row }"><bdi class="tabular-nums">{{ row.original.lines_count }}</bdi></template>
            <template #difference-cell="{ row }">
              <SharedStatusBadge v-if="hasEndDifference(row.original)" size="sm" tone="warning" :label="t('financeBank.differencePill')" />
              <span v-else class="text-muted">{{ dash }}</span>
            </template>
            <template #mobile-row="{ row }">
              <NuxtLink :to="recordTo(row)" class="flex min-w-0 flex-col gap-2">
                <span class="flex items-center justify-between gap-2">
                  <span class="min-w-0 truncate font-semibold text-highlighted"><bdi>{{ row.name }}</bdi></span>
                  <SharedStatusBadge v-if="hasEndDifference(row)" size="sm" tone="warning" :label="t('financeBank.differencePill')" />
                </span>
                <span class="truncate text-sm text-muted">{{ row.journal.name }} · <bdi class="tabular-nums">{{ row.date ?? dash }}</bdi></span>
                <span class="flex items-center justify-between gap-2 text-sm">
                  <Money :amount="row.balance_end_real" :currency="row.currency" />
                  <span class="text-muted">{{ t('financeBank.linesCount', { count: row.lines_count }, row.lines_count) }}</span>
                </span>
              </NuxtLink>
            </template>
          </SharedDataTable>
        </div>
      </SharedPageState>
      <template v-if="query.data.value && !showEmpty" #footer>
        <SharedListFooter :count-label="t('financeBank.footer', { shown: items.length, total }, total)" :page="filters.page" :pages="pages" :disabled="!hydrated || query.isFetching.value" count-test-id="finance-bank-count" @update:page="value => update({ page: value > 1 ? String(value) : undefined })" />
      </template>
    </SharedListCard>
  </div>
</template>
