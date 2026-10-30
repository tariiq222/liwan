<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinancePartnerStatement } from '@liwan/contracts'
import Money from '../invoices/Money.vue'
import { amountColumn } from './reportColumns'
import { AGED_BUCKETS, statementRows, type StatementRow } from './reportRows'
import ReportMobileRow from './ReportMobileRow.vue'
import ReportTotals from './ReportTotals.vue'

// The lines of every currency in one table (each opens with its balance forward), and under it, per currency, the
// amount due, the ending balance and the age buckets when the server sent them.
const props = defineProps<{ report: FinancePartnerStatement }>()
const { t } = useI18n()
const rows = computed(() => statementRows(props.report))
const dash = computed(() => t('app.notAvailable'))
const columns = computed<TableColumn<StatementRow>[]>(() => [
  { id: 'date', header: t('financeReports.columns.date') },
  { id: 'dateDue', header: t('financeReports.columns.dueDate') },
  { id: 'entry', header: t('financeReports.columns.entry') },
  { id: 'ref', header: t('financeReports.columns.reference') },
  { id: 'label', header: t('financeReports.columns.label') },
  amountColumn('debit', t('financeReports.columns.debit')),
  amountColumn('credit', t('financeReports.columns.credit')),
  amountColumn('openAmount', t('financeReports.columns.openAmount')),
  amountColumn('balance', t('financeReports.columns.runningBalance')),
])
const blockTotals = (block: FinancePartnerStatement['currencies'][number]) => [
  { label: t('financeReports.columns.amountDue'), amount: block.amount_due, currency: block.currency },
  { label: t('financeReports.columns.endingBalance'), amount: block.ending_balance, currency: block.currency },
  ...(block.buckets ? AGED_BUCKETS.map(bucket => ({ label: t(`financeReports.buckets.${bucket}`), amount: block.buckets![bucket], currency: block.currency })) : []),
]
const title = (row: StatementRow) => row.forward ? t('financeReports.balanceForward') : row.label || row.entry
const figures = (row: StatementRow) => row.forward
  ? [{ label: t('financeReports.columns.balance'), amount: row.balance ?? 0, currency: row.currency }]
  : [
      { label: t('financeReports.columns.debit'), amount: row.debit, currency: row.currency },
      { label: t('financeReports.columns.credit'), amount: row.credit, currency: row.currency },
      { label: t('financeReports.columns.openAmount'), amount: row.openAmount, currency: row.currency },
    ]
</script>

<template>
  <div class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,1040px)]">
    <SharedDataTable bare :rows="rows" :columns="columns" row-key="key" :empty-text="t('financeReports.empty')" :caption="t('financeReports.reports.partnerStatement.title')">
      <template #date-cell="{ row }">
        <span v-if="row.original.forward" class="font-semibold text-highlighted">{{ t('financeReports.balanceForward') }}</span>
        <bdi v-else class="tabular-nums">{{ row.original.date }}</bdi>
      </template>
      <template #dateDue-cell="{ row }"><bdi v-if="!row.original.forward" class="tabular-nums">{{ row.original.dateDue }}</bdi></template>
      <template #entry-cell="{ row }"><bdi v-if="!row.original.forward">{{ row.original.entry }}</bdi></template>
      <template #ref-cell="{ row }"><bdi v-if="!row.original.forward">{{ row.original.ref || dash }}</bdi></template>
      <template #label-cell="{ row }"><span v-if="!row.original.forward">{{ row.original.label }}</span></template>
      <template #debit-cell="{ row }"><Money v-if="!row.original.forward" :amount="row.original.debit" :currency="row.original.currency" /></template>
      <template #credit-cell="{ row }"><Money v-if="!row.original.forward" :amount="row.original.credit" :currency="row.original.currency" /></template>
      <template #openAmount-cell="{ row }"><Money v-if="!row.original.forward" :amount="row.original.openAmount" :currency="row.original.currency" /></template>
      <template #balance-cell="{ row }">
        <Money v-if="row.original.balance !== null" :amount="row.original.balance" :currency="row.original.currency" />
        <span v-else class="text-muted">{{ dash }}</span>
      </template>
      <template #mobile-row="{ row }"><ReportMobileRow :title="title(row)" :subtitle="row.forward ? undefined : row.date ?? undefined" :figures="figures(row)" /></template>
      <template #footer>
        <div class="flex min-w-0 flex-col gap-2">
          <ReportTotals v-for="block in report.currencies" :key="block.currency" :items="blockTotals(block)" />
        </div>
      </template>
    </SharedDataTable>
  </div>
</template>
