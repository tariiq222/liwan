<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceWithholdingSummary } from '@webvue/contracts'
import Money from '../invoices/Money.vue'
import { amountColumn } from './reportColumns'
import ReportMobileRow from './ReportMobileRow.vue'
import ReportTotals from './ReportTotals.vue'

type Row = FinanceWithholdingSummary['taxes'][number]

const props = defineProps<{ report: FinanceWithholdingSummary }>()
const { t } = useI18n()
const columns = computed<TableColumn<Row>[]>(() => [
  { id: 'tax', header: t('financeReports.columns.tax') },
  amountColumn('rate', t('financeReports.columns.rate')),
  amountColumn('base', t('financeReports.columns.base')),
  amountColumn('withheld', t('financeReports.columns.withheld')),
])
const totals = computed(() => [
  { label: t('financeReports.columns.base'), amount: props.report.base, currency: props.report.currency },
  { label: t('financeReports.columns.withheld'), amount: props.report.withheld, currency: props.report.currency },
])
const figures = (row: Row) => [
  { label: t('financeReports.columns.base'), amount: row.base, currency: props.report.currency },
  { label: t('financeReports.columns.withheld'), amount: row.withheld, currency: props.report.currency },
]
</script>

<template>
  <div class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,640px)]">
    <SharedDataTable bare :rows="report.taxes" :columns="columns" :row-key="row => row.tax.id" :empty-text="t('financeReports.empty')" :caption="t('financeReports.reports.withholding.title')">
      <template #tax-cell="{ row }">{{ row.original.tax.name }}</template>
      <template #rate-cell="{ row }"><bdi v-if="row.original.rate !== null" class="tabular-nums">{{ row.original.rate }}%</bdi></template>
      <template #base-cell="{ row }"><Money :amount="row.original.base" /></template>
      <template #withheld-cell="{ row }"><Money :amount="row.original.withheld" /></template>
      <template #mobile-row="{ row }"><ReportMobileRow :title="row.tax.name" :figures="figures(row)" /></template>
      <template #footer><ReportTotals :items="totals" /></template>
    </SharedDataTable>
  </div>
</template>
