<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinancePaymentTerm } from '@liwan/contracts'
import type { RowAction } from '@liwan/ui/app/components/shared/data/RowActions.vue'
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'
import { h } from 'vue'
import { useArchiveSetupPaymentTerm, useSetupPaymentTerms } from '@/composables/finance/useFinanceRecords'
import RecordArchiveConfirm from './RecordArchiveConfirm.vue'
import RecordsFilters from './RecordsFilters.vue'
import { useRecordList } from './useRecordList'

// The payment terms of the current company, with the terms that come with the chart (shared by every company: read only).
const props = defineProps<{ background?: boolean }>()
const { t } = useI18n()
const { can } = useAccess()
const route = useRoute()
const canManage = computed(() => can('finance.payment_terms.manage'))
const list = useRecordList<FinancePaymentTerm>({ fallbackPath: '/settings/apps/finance/payment-terms', background: () => props.background, list: params => useSetupPaymentTerms(params) })
const { mutateAsync: send, isPending: archiving } = useArchiveSetupPaymentTerm()

const archivingItem = ref<FinancePaymentTerm | null>(null)

const columns = computed<TableColumn<FinancePaymentTerm>[]>(() => [
  { id: 'name', header: t('financeRecords.paymentTerms.columns.name') },
  { id: 'lines', header: t('financeRecords.paymentTerms.columns.lines') },
  { id: 'state', header: t('financeRecords.columns.state') },
  ...(canManage.value ? [{ id: 'actions', header: () => h('span', { class: 'sr-only' }, t('app.actions')), meta: { class: { th: 'w-0', td: 'w-0 text-end' } } }] : []),
])
const linesLabel = (term: FinancePaymentTerm) => term.lines
  .map(line => t(`financeRecords.paymentTerms.lineSummary.${line.value}`, { amount: line.value_amount, days: line.nb_days }))
  .join(' · ')
const stateTone = (term: FinancePaymentTerm) => term.active ? 'success' : 'neutral'
const stateLabel = (term: FinancePaymentTerm) => t(`financeRecords.states.${term.active ? 'active' : 'archived'}`)
// A term shared by every company comes with the chart; only a company's own terms are edited or archived here.
const actions = (term: FinancePaymentTerm): RowAction[] => term.shared
  ? []
  : [
      { label: t('financeRecords.actions.edit'), icon: 'i-lucide-pencil', to: { path: `/settings/apps/finance/payment-terms/${term.id}/edit`, query: returnToQuery(route.fullPath) } },
      { label: t(`financeRecords.actions.${term.active ? 'archive' : 'unarchive'}`), icon: term.active ? 'i-lucide-archive' : 'i-lucide-archive-restore', onSelect: () => { archivingItem.value = term } },
    ]
</script>

<template>
  <div class="grid gap-(--liwan-gap-card)">
    <RecordArchiveConfirm
      v-if="archivingItem"
      :key="archivingItem.id"
      scope="paymentTerms"
      :name="archivingItem.name"
      :active="archivingItem.active"
      :pending="archiving"
      :send="archive => send({ id: archivingItem!.id, archive })"
      @done="archivingItem = null"
      @cancel="archivingItem = null"
    />
    <SharedListCard data-testid="finance-record-terms">
      <template #filters>
        <RecordsFilters
          id-prefix="finance-record-terms" :filters="list.filters.value" :active-count="list.activeCount.value" :hydrated="list.hydrated.value"
          :search="list.search.value" :search-placeholder="t('financeRecords.paymentTerms.search')"
          @update:search="value => { list.search.value = value }" @submit="list.submitSearch" @clear="list.clearFilters" @state="list.setState"
        />
      </template>
      <SharedPageState :error="list.query.error.value" :keep-content="list.items.value.length > 0" @retry="list.query.refetch">
        <SharedEmptyState v-if="list.showEmpty.value" :icon="list.activeCount.value ? 'i-lucide-filter-x' : 'i-lucide-calendar-clock'" class="m-(--liwan-card-pad-dense)" :title="t(list.activeCount.value ? 'app.noResults' : 'financeRecords.paymentTerms.empty')" />
        <div v-else class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,640px)]">
          <SharedDataTable bare :rows="list.items.value" :columns="columns" row-key="id" :loading="list.query.isPending.value" :caption="t('financeRecords.paymentTerms.title')">
            <template #name-cell="{ row }">
              <span class="font-semibold text-highlighted">{{ row.original.name }}</span>
              <SharedStatusBadge v-if="row.original.shared" size="sm" tone="neutral" class="ms-2" :label="t('financeRecords.paymentTerms.shared')" />
            </template>
            <template #lines-cell="{ row }">{{ linesLabel(row.original) }}</template>
            <template #state-cell="{ row }"><SharedStatusBadge size="sm" :tone="stateTone(row.original)" :label="stateLabel(row.original)" /></template>
            <template #actions-cell="{ row }">
              <SharedRowActions v-if="!row.original.shared" :actions="actions(row.original)" :label="t('financeRecords.paymentTerms.actionsNamed', { name: row.original.name })" :disabled="!list.hydrated.value || archivingItem !== null" />
            </template>
            <template #mobile-row="{ row }">
              <div class="flex min-w-0 items-start justify-between gap-2" :data-testid="`finance-record-term-${row.id}`">
                <div class="flex min-w-0 flex-col gap-1">
                  <span class="truncate font-semibold text-highlighted">{{ row.name }}</span>
                  <span class="text-sm text-muted">{{ linesLabel(row) }}</span>
                  <SharedStatusBadge size="sm" class="w-fit" :tone="stateTone(row)" :label="stateLabel(row)" />
                </div>
                <SharedRowActions v-if="canManage && !row.shared" :actions="actions(row)" :label="t('financeRecords.paymentTerms.actionsNamed', { name: row.name })" :disabled="!list.hydrated.value || archivingItem !== null" />
              </div>
            </template>
          </SharedDataTable>
        </div>
      </SharedPageState>
      <template v-if="list.query.data.value && !list.showEmpty.value" #footer>
        <SharedListFooter :count-label="t('financeRecords.paymentTerms.footer', { shown: list.items.value.length, total: list.total.value }, list.total.value)" :page="list.filters.value.page" :pages="list.pages.value" :disabled="!list.hydrated.value || list.query.isFetching.value" count-test-id="finance-record-term-count" @update:page="list.setPage" />
      </template>
    </SharedListCard>
  </div>
</template>
