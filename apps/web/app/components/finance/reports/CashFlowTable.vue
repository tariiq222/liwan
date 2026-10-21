<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceCashFlow } from '@webvue/contracts'
import Money from '../invoices/Money.vue'
import { amountColumn } from './reportColumns'
import { cashFlowRows, type CashFlowRow } from './reportRows'
import ReportMobileRow from './ReportMobileRow.vue'
import ReportTotals from './ReportTotals.vue'

// The statement of cash flows (indirect method): operating, investing and financing activities with their subtotals, then the
// opening and closing cash. The server's check against the change of the cash accounts is the footer; a difference is shown
// as a warning because the statement then does not close. It is built from the books and is never a filed statement.
const props = defineProps<{ report: FinanceCashFlow }>()
const { t } = useI18n()
const rows = computed(() => cashFlowRows(props.report))
const columns = computed<TableColumn<CashFlowRow>[]>(() => [
  { id: 'label', header: t('financeReports.columns.item') },
  amountColumn('amount', t('financeReports.columns.amount')),
])
const label = (row: CashFlowRow) => 'label' in row ? row.label : t(`financeReports.cashFlow.rows.${row.labelKey}`)
const weight = (row: CashFlowRow) => row.kind === 'total' ? 'font-semibold text-highlighted' : ''
const checks = computed(() => [{ label: t('financeReports.cashFlow.difference'), amount: props.report.difference, currency: props.report.currency }])
</script>

<template>
  <div class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,480px)]">
    <UAlert color="info" variant="subtle" icon="i-lucide-info" class="m-(--webvue-card-pad-dense) w-auto" :title="t('financeReports.cashFlow.notice')" data-testid="finance-cash-flow-notice" />
    <UAlert v-if="report.difference !== 0" role="alert" color="warning" variant="subtle" icon="i-lucide-triangle-alert" class="mx-(--webvue-card-pad-dense) mb-(--webvue-card-pad-dense) w-auto" :title="t('financeReports.cashFlow.notClosed')" data-testid="finance-cash-flow-difference" />
    <SharedDataTable bare :rows="rows" :columns="columns" row-key="key" :empty-text="t('financeReports.empty')" :caption="t('financeReports.reports.cashFlow.title')">
      <template #label-cell="{ row }"><span :class="weight(row.original)">{{ label(row.original) }}</span></template>
      <template #amount-cell="{ row }"><span :class="weight(row.original)"><Money :amount="row.original.amount" :currency="report.currency" /></span></template>
      <template #mobile-row="{ row }"><ReportMobileRow :title="label(row)" :figures="[{ label: t('financeReports.columns.amount'), amount: row.amount, currency: report.currency }]" /></template>
      <template #footer><ReportTotals :items="checks"><SharedStatusBadge size="sm" :tone="report.difference === 0 ? 'success' : 'warning'" :label="t(report.difference === 0 ? 'financeReports.cashFlow.closes' : 'financeReports.cashFlow.open')" /></ReportTotals></template>
    </SharedDataTable>
  </div>
</template>
