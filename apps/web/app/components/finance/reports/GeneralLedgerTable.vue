<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceGeneralLedger } from '@liwan/contracts'
import Money from '../invoices/Money.vue'
import { amountColumn } from './reportColumns'
import { ledgerRows, type LedgerRow } from './reportRows'
import { accountToggleTo } from './reportLinks'
import ReportMobileRow from './ReportMobileRow.vue'

// The account totals; the selected account (`account_id` in the URL) opens its page of lines right under it.
// An account row is a link that selects it, or closes it when it is the open one.
const props = defineProps<{ report: FinanceGeneralLedger; selectedId: number | null }>()
const { t } = useI18n()
const route = useRoute()
const rows = computed(() => ledgerRows(props.report, props.selectedId))
const dash = computed(() => t('app.notAvailable'))

const columns = computed<TableColumn<LedgerRow>[]>(() => [
  { id: 'name', header: t('financeReports.columns.accountOrDate') },
  { id: 'entry', header: t('financeReports.columns.entry') },
  { id: 'partner', header: t('financeReports.columns.partner') },
  { id: 'label', header: t('financeReports.columns.label') },
  amountColumn('initial', t('financeReports.columns.initialBalance')),
  amountColumn('debit', t('financeReports.columns.debit')),
  amountColumn('credit', t('financeReports.columns.credit')),
  amountColumn('balance', t('financeReports.columns.runningBalance')),
])

const accountTo = (id: number) => accountToggleTo(route, id, props.selectedId)
const accountFigures = (row: Extract<LedgerRow, { kind: 'account' }>) => [
  { label: t('financeReports.columns.initialBalance'), amount: row.account.initial_balance },
  { label: t('financeReports.columns.debit'), amount: row.account.debit },
  { label: t('financeReports.columns.credit'), amount: row.account.credit },
  { label: t('financeReports.columns.endingBalance'), amount: row.account.ending_balance },
]
const lineFigures = (row: Extract<LedgerRow, { kind: 'line' }>) => [
  { label: t('financeReports.columns.debit'), amount: row.line.debit },
  { label: t('financeReports.columns.credit'), amount: row.line.credit },
  { label: t('financeReports.columns.runningBalance'), amount: row.line.balance },
]
</script>

<template>
  <div class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,960px)]">
    <SharedDataTable bare :rows="rows" :columns="columns" row-key="key" :empty-text="t('financeReports.empty')" :caption="t('financeReports.reports.generalLedger.title')">
      <template #name-cell="{ row }">
        <NuxtLink v-if="row.original.kind === 'account'" :to="accountTo(row.original.account.account.id)" class="inline-flex items-center gap-2 font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" :data-testid="`finance-ledger-account-${row.original.account.account.id}`">
          <UIcon :name="row.original.account.account.id === selectedId ? 'i-lucide-chevron-down' : 'i-lucide-chevron-left'" class="size-4 shrink-0 text-muted" aria-hidden="true" />
          <bdi class="tabular-nums">{{ row.original.account.account.code }}</bdi>
          <span>{{ row.original.account.account.name }}</span>
        </NuxtLink>
        <span v-else class="ps-6"><bdi class="tabular-nums">{{ row.original.line.date }}</bdi></span>
      </template>
      <template #entry-cell="{ row }">
        <span v-if="row.original.kind === 'line'"><bdi>{{ row.original.line.entry }}</bdi> <span class="text-muted"><bdi>{{ row.original.line.journal }}</bdi></span></span>
      </template>
      <template #partner-cell="{ row }"><span v-if="row.original.kind === 'line'">{{ row.original.line.partner?.name ?? dash }}</span></template>
      <template #label-cell="{ row }"><span v-if="row.original.kind === 'line'">{{ row.original.line.label }}</span></template>
      <template #initial-cell="{ row }"><Money v-if="row.original.kind === 'account'" :amount="row.original.account.initial_balance" /></template>
      <template #debit-cell="{ row }"><Money :amount="row.original.kind === 'account' ? row.original.account.debit : row.original.line.debit" /></template>
      <template #credit-cell="{ row }"><Money :amount="row.original.kind === 'account' ? row.original.account.credit : row.original.line.credit" /></template>
      <template #balance-cell="{ row }"><Money :amount="row.original.kind === 'account' ? row.original.account.ending_balance : row.original.line.balance" /></template>
      <template #mobile-row="{ row }">
        <NuxtLink v-if="row.kind === 'account'" :to="accountTo(row.account.account.id)" class="block">
          <ReportMobileRow :title="row.account.account.name" :subtitle="row.account.account.code" :figures="accountFigures(row)" />
        </NuxtLink>
        <ReportMobileRow v-else class="ps-4" :title="row.line.label || row.line.entry" :subtitle="row.line.date" :figures="lineFigures(row)" />
      </template>
    </SharedDataTable>
  </div>
</template>
