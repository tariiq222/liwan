<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceTrialBalance } from '@webvue/contracts'
import Money from '../invoices/Money.vue'
import { amountColumn } from './reportColumns'
import ReportMobileRow from './ReportMobileRow.vue'
import ReportTotals from './ReportTotals.vue'

type Row = FinanceTrialBalance['accounts'][number]

const props = defineProps<{ report: FinanceTrialBalance }>()
const { t } = useI18n()
const columns = computed<TableColumn<Row>[]>(() => [
  { id: 'code', header: t('financeReports.columns.code') },
  { id: 'account', header: t('financeReports.columns.account') },
  amountColumn('initial_balance', t('financeReports.columns.initialBalance')),
  amountColumn('debit', t('financeReports.columns.debit')),
  amountColumn('credit', t('financeReports.columns.credit')),
  amountColumn('balance', t('financeReports.columns.balance')),
  amountColumn('ending_balance', t('financeReports.columns.endingBalance')),
])
const currency = computed(() => props.report.currency)
const totals = computed(() => [
  { label: t('financeReports.columns.debit'), amount: props.report.totals.debit, currency: currency.value },
  { label: t('financeReports.columns.credit'), amount: props.report.totals.credit, currency: currency.value },
  { label: t('financeReports.columns.endingBalance'), amount: props.report.totals.ending_balance, currency: currency.value },
])
const figures = (row: Row) => [
  { label: t('financeReports.columns.debit'), amount: row.debit },
  { label: t('financeReports.columns.credit'), amount: row.credit },
  { label: t('financeReports.columns.balance'), amount: row.balance },
  { label: t('financeReports.columns.endingBalance'), amount: row.ending_balance },
]
</script>

<template>
  <div class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,880px)]">
    <SharedDataTable bare :rows="report.accounts" :columns="columns" :row-key="row => row.account.id" :empty-text="t('financeReports.empty')" :caption="t('financeReports.reports.trialBalance.title')">
      <template #code-cell="{ row }"><bdi class="tabular-nums">{{ row.original.account.code }}</bdi></template>
      <template #account-cell="{ row }">{{ row.original.account.name }}</template>
      <template #initial_balance-cell="{ row }"><Money :amount="row.original.initial_balance" /></template>
      <template #debit-cell="{ row }"><Money :amount="row.original.debit" /></template>
      <template #credit-cell="{ row }"><Money :amount="row.original.credit" /></template>
      <template #balance-cell="{ row }"><Money :amount="row.original.balance" /></template>
      <template #ending_balance-cell="{ row }"><Money :amount="row.original.ending_balance" /></template>
      <template #mobile-row="{ row }"><ReportMobileRow :title="row.account.name" :subtitle="row.account.code" :figures="figures(row)" /></template>
      <template #footer><ReportTotals :items="totals" /></template>
    </SharedDataTable>
  </div>
</template>
