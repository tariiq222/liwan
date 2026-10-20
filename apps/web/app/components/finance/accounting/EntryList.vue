<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { JournalEntry } from '@webvue/contracts'
import { recordNumberHeader } from '@webvue/ui/app/utils/recordNumberHeader'
import { useFinanceEntryList, useFinanceGeneralJournals } from '@/composables/finance/useFinanceEntries'
import { useRouteListFilters } from '@/composables/useRouteListFilters'
import Money from '../invoices/Money.vue'
import { listReturnTo, useListLocation } from '../invoices/listLocation'
import EntryKpiStrip from './EntryKpiStrip.vue'
import { ENTRY_PAGE_SIZE, ENTRY_STATES, entryActiveFilterCount, entryFiltersFromQuery, entryListParams } from './entryListParams'
import { ENTRIES_PATH, entryRecordPath, entryTitle } from './entryPaths'
import { ENTRY_STATE_TONE } from './entryTones'

// The card of the journal entries list. The page owns the SharedListPage shell and heading (useEntryListPage).
// `background` is the list behind the create panel: it reads its filters from the panel's returnTo.
const props = defineProps<{ background?: boolean }>()
const { t } = useI18n()
const { can } = useAccess()
const { shown: kpisShown } = useKpiVisibility()
const allowed = computed(() => can('finance.entries.read'))
const { hydrated, filterQuery, search, update } = useRouteListFilters({
  background: () => props.background,
  fallbackPath: () => ENTRIES_PATH,
  safeReturnTo: listReturnTo(ENTRIES_PATH),
})
const filters = computed(() => entryFiltersFromQuery(filterQuery.value))
const activeCount = computed(() => entryActiveFilterCount(filters.value))
const query = useFinanceEntryList(() => entryListParams(filters.value), allowed)
const journals = useFinanceGeneralJournals(() => can('finance.journals.read'))
const items = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / ENTRY_PAGE_SIZE)))
const showEmpty = computed(() => !query.isPending.value && !query.error.value && items.value.length === 0)

const listLocation = useListLocation(ENTRIES_PATH, props.background)
const recordTo = (entry: JournalEntry) => ({ path: entryRecordPath(entry.id), query: { returnTo: listLocation.value } })

const stateItems = computed(() => [
  { value: 'all', label: t('financeAccounting.filters.allStates') },
  ...ENTRY_STATES.map(state => ({ value: state, label: t(`financeAccounting.states.${state}`) })),
])
const journalItems = computed(() => [
  { value: 'all', label: t('financeAccounting.filters.allJournals') },
  ...(journals.data.value?.items ?? []).map(journal => ({ value: String(journal.id), label: journal.name })),
])
function clearFilters() {
  search.value = ''
  void update({ q: undefined, state: undefined, journal_id: undefined, date_from: undefined, date_to: undefined, page: undefined })
}
function setChoice(key: 'state' | 'journal_id', value: unknown) {
  void update({ [key]: value === 'all' ? undefined : String(value), page: undefined })
}
function setDate(key: 'date_from' | 'date_to', value: string | null) {
  void update({ [key]: value ?? undefined, page: undefined })
}

const numeric = { class: { th: 'text-end', td: 'text-end' } }
const columns = computed<TableColumn<JournalEntry>[]>(() => [
  { id: 'record_number', header: () => recordNumberHeader(t), meta: { class: { th: 'w-[48px] min-w-[48px] px-2', td: 'w-[48px] min-w-[48px] px-2' } } },
  { id: 'name', header: t('financeAccounting.columns.number') },
  { id: 'date', header: t('financeAccounting.columns.date') },
  { id: 'journal', header: t('financeAccounting.columns.journal') },
  { id: 'ref', header: t('financeAccounting.columns.ref') },
  { id: 'amount_total', header: t('financeAccounting.columns.total'), meta: numeric },
  { id: 'state', header: t('financeAccounting.columns.state') },
])
const dash = computed(() => t('app.notAvailable'))
const label = (entry: JournalEntry) => entryTitle(entry, t('financeAccounting.draftNumber'))
</script>

<template>
  <SharedForbiddenState v-if="!allowed" :description="t('financeAccounting.forbidden')" />
  <div v-else class="webvue-page-stack">
    <EntryKpiStrip v-if="kpisShown" :filters="filters" />
    <SharedListCard>
      <template #filters>
        <SharedFilterBar embedded class="w-full" :active-count="activeCount" :default-open="!!filters.state || !!filters.journalId || !!filters.dateFrom || !!filters.dateTo" :disabled="!hydrated" @clear="clearFilters">
          <template #search>
            <form @submit.prevent="update({ q: search.trim() || undefined, page: undefined })">
              <UInput v-model="search" class="w-full" icon="i-lucide-search" :placeholder="t('financeAccounting.filters.search')" :aria-label="t('financeAccounting.filters.search')" :disabled="!hydrated" />
            </form>
          </template>
          <SharedFilterField :label="t('financeAccounting.filters.state')" for="finance-entry-filter-state">
            <USelect id="finance-entry-filter-state" class="w-full md:w-44" :model-value="filters.state ?? 'all'" :items="stateItems" :disabled="!hydrated" @update:model-value="setChoice('state', $event)" />
          </SharedFilterField>
          <SharedFilterField :label="t('financeAccounting.filters.journal')" for="finance-entry-filter-journal">
            <USelect id="finance-entry-filter-journal" class="w-full md:w-56" :model-value="filters.journalId ? String(filters.journalId) : 'all'" :items="journalItems" :disabled="!hydrated" @update:model-value="setChoice('journal_id', $event)" />
          </SharedFilterField>
          <SharedFilterField :label="t('financeAccounting.filters.dateFrom')" for="finance-entry-filter-from">
            <SharedDateField id="finance-entry-filter-from" :model-value="filters.dateFrom" :max-value="filters.dateTo" :disabled="!hydrated" @update:model-value="setDate('date_from', $event)" />
          </SharedFilterField>
          <SharedFilterField :label="t('financeAccounting.filters.dateTo')" for="finance-entry-filter-to">
            <SharedDateField id="finance-entry-filter-to" :model-value="filters.dateTo" :min-value="filters.dateFrom" :disabled="!hydrated" @update:model-value="setDate('date_to', $event)" />
          </SharedFilterField>
        </SharedFilterBar>
      </template>
      <SharedPageState :error="query.error.value" :keep-content="items.length > 0" @retry="query.refetch">
        <SharedEmptyState v-if="showEmpty" class="m-(--webvue-card-pad-dense)" :title="t(activeCount ? 'app.noResults' : 'financeAccounting.entries.empty')" />
        <div v-else class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,820px)]">
          <SharedDataTable bare :rows="items" :columns="columns" row-key="id" :row-to="recordTo" :loading="query.isPending.value" :caption="t('financeAccounting.entries.title')">
            <template #record_number-cell="{ row }"><SharedRecordNumber :value="row.original.id" /></template>
            <template #name-cell="{ row }">
              <NuxtLink :to="recordTo(row.original)" class="font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" :data-testid="`finance-entry-row-${row.original.id}`" @click="!hydrated && $event.preventDefault()"><bdi>{{ label(row.original) }}</bdi></NuxtLink>
            </template>
            <template #date-cell="{ row }"><bdi class="tabular-nums">{{ row.original.date }}</bdi></template>
            <template #journal-cell="{ row }">{{ row.original.journal.name }}</template>
            <template #ref-cell="{ row }">{{ row.original.ref || dash }}</template>
            <template #amount_total-cell="{ row }"><Money :amount="row.original.amount_total" :currency="row.original.currency" /></template>
            <template #state-cell="{ row }"><SharedStatusBadge size="sm" :tone="ENTRY_STATE_TONE[row.original.state]" :label="t(`financeAccounting.states.${row.original.state}`)" /></template>
            <template #mobile-row="{ row }">
              <NuxtLink :to="recordTo(row)" class="flex min-w-0 flex-col gap-2">
                <span class="flex items-center justify-between gap-2">
                  <span class="min-w-0 truncate font-semibold text-highlighted"><bdi>{{ label(row) }}</bdi></span>
                  <SharedStatusBadge size="sm" :tone="ENTRY_STATE_TONE[row.state]" :label="t(`financeAccounting.states.${row.state}`)" />
                </span>
                <span class="truncate text-sm text-muted">{{ row.journal.name }} · <bdi class="tabular-nums">{{ row.date }}</bdi></span>
                <span class="flex items-center justify-between gap-2 text-sm">
                  <span class="truncate text-muted">{{ row.ref || dash }}</span>
                  <Money :amount="row.amount_total" :currency="row.currency" />
                </span>
              </NuxtLink>
            </template>
          </SharedDataTable>
        </div>
      </SharedPageState>
      <template v-if="query.data.value && !showEmpty" #footer>
        <SharedListFooter :count-label="t('financeAccounting.entries.footer', { shown: items.length, total }, total)" :page="filters.page" :pages="pages" :disabled="!hydrated || query.isFetching.value" count-test-id="finance-entry-count" @update:page="value => update({ page: value > 1 ? String(value) : undefined })" />
      </template>
    </SharedListCard>
  </div>
</template>
