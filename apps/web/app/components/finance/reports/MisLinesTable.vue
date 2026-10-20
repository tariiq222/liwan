<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceReportLine } from '@webvue/contracts'
import Money from '../invoices/Money.vue'
import { amountColumn } from './reportColumns'
import { misRows, type MisKind, type MisRow } from './reportRows'
import ReportMobileRow from './ReportMobileRow.vue'
import ReportTotals from './ReportTotals.vue'

// A statement of `{code, label, value}` lines (profit and loss, balance sheet, Zakat base): the label comes from the code's
// locale key, the server's description stands in for a code the locale lacks, and subtotals are bold. `totals` closes the
// table with labelled amounts; the default slot adds figures that are not amounts (the Zakat rate).
const props = defineProps<{
  kind: MisKind
  lines: readonly FinanceReportLine[]
  currency: string
  caption: string
  /** Codes of lines the table leaves out because `totals` shows them. */
  hidden?: readonly string[]
  totals?: readonly { label: string; amount: number }[]
}>()
const { t, te } = useI18n()
const rows = computed(() => misRows(props.kind, props.lines, props.hidden))
const columns = computed<TableColumn<MisRow>[]>(() => [
  { id: 'label', header: t('financeReports.columns.item') },
  amountColumn('value', t('financeReports.columns.amount')),
])
const label = (row: MisRow) => te(`financeReports.mis.${props.kind}.${row.code}`) ? t(`financeReports.mis.${props.kind}.${row.code}`) : row.label
const weight = (row: MisRow) => row.strong ? 'font-semibold text-highlighted' : ''
const footer = computed(() => props.totals?.map(item => ({ ...item, currency: props.currency })))
</script>

<template>
  <div class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,480px)]">
    <SharedDataTable bare :rows="rows" :columns="columns" row-key="code" :empty-text="t('financeReports.empty')" :caption="caption">
      <template #label-cell="{ row }"><span :class="weight(row.original)">{{ label(row.original) }}</span></template>
      <template #value-cell="{ row }"><span :class="weight(row.original)"><Money :amount="row.original.value" :currency="currency" /></span></template>
      <template #mobile-row="{ row }"><ReportMobileRow :title="label(row)" :figures="[{ label: t('financeReports.columns.amount'), amount: row.value, currency }]" /></template>
      <template v-if="footer" #footer><ReportTotals :items="footer"><slot /></ReportTotals></template>
    </SharedDataTable>
  </div>
</template>
