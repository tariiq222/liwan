<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceAnalyticReport, FinanceAnalyticReportLine } from '@liwan/contracts'
import Money from '../invoices/Money.vue'
import { amountColumn } from './reportColumns'
import { accountToggleTo } from './reportLinks'
import { analyticRows, type AnalyticRow } from './reportRows'
import ReportMobileRow from './ReportMobileRow.vue'
import ReportTotals from './ReportTotals.vue'

// The income and expense of each cost center; the selected one (`account_id` in the URL) opens its page of analytic items
// right under it. A cost center row is a link that selects it, or closes it when it is the open one.
const props = defineProps<{ report: FinanceAnalyticReport; selectedId: number | null; lines: readonly FinanceAnalyticReportLine[]; linesFailed: boolean }>()
const { t } = useI18n()
const route = useRoute()
const rows = computed(() => analyticRows(props.report, props.selectedId, props.lines))
const currency = computed(() => props.report.currency)
const dash = computed(() => t('app.notAvailable'))

const columns = computed<TableColumn<AnalyticRow>[]>(() => [
  { id: 'name', header: t('financeReports.columns.costCenterOrDate') },
  { id: 'plan', header: t('financeReports.columns.planOrAccount') },
  amountColumn('income', t('financeReports.columns.income')),
  amountColumn('expense', t('financeReports.columns.expense')),
  amountColumn('net', t('financeReports.columns.net')),
])
const totals = computed(() => [
  { label: t('financeReports.columns.income'), amount: props.report.totals.income, currency: currency.value },
  { label: t('financeReports.columns.expense'), amount: props.report.totals.expense, currency: currency.value },
  { label: t('financeReports.columns.net'), amount: props.report.totals.net, currency: currency.value },
])

const accountTo = (id: number) => accountToggleTo(route, id, props.selectedId)
// An item is income (a positive amount) or expense (negative); the table shows each in its own column as a positive figure.
const lineIncome = (line: FinanceAnalyticReportLine) => line.kind === 'income' ? line.amount : 0
const lineExpense = (line: FinanceAnalyticReportLine) => line.kind === 'expense' ? Math.abs(line.amount) : 0
const lineLabel = (line: FinanceAnalyticReportLine) => line.name || line.ref
const accountFigures = (row: Extract<AnalyticRow, { kind: 'account' }>) => [
  { label: t('financeReports.columns.income'), amount: row.row.income },
  { label: t('financeReports.columns.expense'), amount: row.row.expense },
  { label: t('financeReports.columns.net'), amount: row.row.net },
]
const lineFigures = (row: Extract<AnalyticRow, { kind: 'line' }>) => [
  { label: t('financeReports.columns.income'), amount: lineIncome(row.line) },
  { label: t('financeReports.columns.expense'), amount: lineExpense(row.line) },
]
</script>

<template>
  <div class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,820px)]">
    <UAlert v-if="linesFailed" role="alert" color="error" variant="subtle" class="m-(--liwan-card-pad-dense)" :title="t('financeReports.linesFailed')" />
    <SharedDataTable bare :rows="rows" :columns="columns" row-key="key" :empty-text="t('financeReports.empty')" :caption="t('financeReports.reports.analytic.title')">
      <template #name-cell="{ row }">
        <NuxtLink v-if="row.original.kind === 'account'" :to="accountTo(row.original.row.account.id)" class="inline-flex items-center gap-2 font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" :data-testid="`finance-analytic-report-account-${row.original.row.account.id}`">
          <UIcon :name="row.original.row.account.id === selectedId ? 'i-lucide-chevron-down' : 'i-lucide-chevron-left'" class="size-4 shrink-0 text-muted" aria-hidden="true" />
          <bdi class="tabular-nums">{{ row.original.row.account.code || dash }}</bdi>
          <span>{{ row.original.row.account.name }}</span>
        </NuxtLink>
        <span v-else class="flex flex-col ps-6"><bdi class="tabular-nums">{{ row.original.line.date }}</bdi><span class="text-sm text-muted">{{ lineLabel(row.original.line) }}</span></span>
      </template>
      <template #plan-cell="{ row }">
        <template v-if="row.original.kind === 'account'">{{ row.original.row.plan.name }}</template>
        <span v-else class="flex flex-col"><span>{{ row.original.line.general_account.name }}</span><span v-if="row.original.line.partner" class="text-sm text-muted">{{ row.original.line.partner.name }}</span></span>
      </template>
      <template #income-cell="{ row }"><Money :amount="row.original.kind === 'account' ? row.original.row.income : lineIncome(row.original.line)" /></template>
      <template #expense-cell="{ row }"><Money :amount="row.original.kind === 'account' ? row.original.row.expense : lineExpense(row.original.line)" /></template>
      <template #net-cell="{ row }"><Money v-if="row.original.kind === 'account'" :amount="row.original.row.net" /></template>
      <template #mobile-row="{ row }">
        <NuxtLink v-if="row.kind === 'account'" :to="accountTo(row.row.account.id)" class="block">
          <ReportMobileRow :title="row.row.account.name" :subtitle="`${row.row.account.code || dash} · ${row.row.plan.name}`" :figures="accountFigures(row)" />
        </NuxtLink>
        <ReportMobileRow v-else class="ps-4" :title="lineLabel(row.line) || row.line.general_account.name" :subtitle="row.line.date" :figures="lineFigures(row)" />
      </template>
      <template #footer><ReportTotals :items="totals" /></template>
    </SharedDataTable>
  </div>
</template>
