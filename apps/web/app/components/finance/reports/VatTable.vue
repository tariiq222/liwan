<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceVatSummary } from '@webvue/contracts'
import Money from '../invoices/Money.vue'
import { amountColumn } from './reportColumns'
import { vatRows, type VatTableRow } from './reportRows'
import ReportMobileRow from './ReportMobileRow.vue'
import ReportTotals from './ReportTotals.vue'

// Output VAT (sales) and input VAT (purchases) in one table, each section closed by its total; the net payable is the footer.
// A negative net payable is a refund position.
const props = defineProps<{ report: FinanceVatSummary }>()
const { t } = useI18n()
const rows = computed(() => vatRows(props.report))
const columns = computed<TableColumn<VatTableRow>[]>(() => [
  { id: 'section', header: t('financeReports.columns.section') },
  { id: 'tax', header: t('financeReports.columns.tax') },
  amountColumn('rate', t('financeReports.columns.rate')),
  amountColumn('base', t('financeReports.columns.base')),
  amountColumn('taxAmount', t('financeReports.columns.taxAmount')),
])
const taxName = (row: VatTableRow) => row.tax?.name ?? t(`financeReports.vat.${row.section}Total`)
const net = computed(() => [{ label: t('financeReports.vat.netPayable'), amount: props.report.net_payable, currency: props.report.currency }])
const figures = (row: VatTableRow) => [
  { label: t('financeReports.columns.base'), amount: row.base, currency: props.report.currency },
  { label: t('financeReports.columns.taxAmount'), amount: row.taxAmount, currency: props.report.currency },
]
</script>

<template>
  <div class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,720px)]">
    <SharedDataTable bare :rows="rows" :columns="columns" row-key="key" :empty-text="t('financeReports.empty')" :caption="t('financeReports.reports.vat.title')">
      <template #section-cell="{ row }"><span class="text-muted">{{ t(`financeReports.vat.${row.original.section}`) }}</span></template>
      <template #tax-cell="{ row }"><span :class="row.original.tax ? '' : 'font-semibold text-highlighted'">{{ taxName(row.original) }}</span></template>
      <template #rate-cell="{ row }"><bdi v-if="row.original.rate !== null" class="tabular-nums">{{ row.original.rate }}%</bdi></template>
      <template #base-cell="{ row }"><span :class="row.original.tax ? '' : 'font-semibold'"><Money :amount="row.original.base" /></span></template>
      <template #taxAmount-cell="{ row }"><span :class="row.original.tax ? '' : 'font-semibold'"><Money :amount="row.original.taxAmount" /></span></template>
      <template #mobile-row="{ row }"><ReportMobileRow :title="taxName(row)" :subtitle="t(`financeReports.vat.${row.section}`)" :figures="figures(row)" /></template>
      <template #footer>
        <ReportTotals :items="net">
          <SharedStatusBadge v-if="report.net_payable !== 0" size="sm" :tone="report.net_payable > 0 ? 'warning' : 'success'" :label="t(report.net_payable > 0 ? 'financeReports.vat.payable' : 'financeReports.vat.refund')" />
        </ReportTotals>
      </template>
    </SharedDataTable>
  </div>
</template>
