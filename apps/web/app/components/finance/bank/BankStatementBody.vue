<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceBankLine } from '@webvue/contracts'
import type { KpiTile } from '@webvue/ui/app/utils/kpiTile'
import { formatAmount } from '../invoices/formatAmount'
import Money from '../invoices/Money.vue'
import { BANK_LINE_TONE, lineState, reconcilePath } from './bankModel'
import type { BankStatementRecordState } from './useBankStatementRecord'

// The main column of a statement's record page: the figures of its own lines and the lines with their reconciliation
// state; an open line links to its reconciliation page for a caller who may reconcile.
const props = defineProps<{ record: BankStatementRecordState }>()
const { t } = useI18n()
const { can } = useAccess()
const { shown: kpisShown } = useKpiVisibility()
const hydrated = useHydrated()
const statement = computed(() => props.record.statement)
const canReconcile = computed(() => can('finance.bank.manage'))
const dash = computed(() => t('app.notAvailable'))

const tiles = computed<KpiTile[]>(() => {
  const summary = props.record.summary
  const currency = statement.value?.currency ?? ''
  if (!summary) return []
  return [
    { id: 'reconciled', label: t('financeBank.summary.reconciled'), value: summary.reconciledCount, icon: 'i-lucide-check-check', tone: 'success', hint: `${formatAmount(summary.reconciledAmount)} ${currency}` },
    { id: 'open', label: t('financeBank.summary.open'), value: summary.openCount, icon: 'i-lucide-circle-dashed', tone: summary.openCount ? 'warning' : 'neutral', hint: `${formatAmount(summary.openAmount)} ${currency}` },
  ]
})

const end = { class: { th: 'text-end', td: 'text-end' } }
const columns = computed<TableColumn<FinanceBankLine>[]>(() => [
  { id: 'date', header: t('financeBank.columns.date') },
  { id: 'payment_ref', header: t('financeBank.columns.label') },
  { id: 'partner', header: t('financeBank.columns.partner') },
  { id: 'amount', header: t('financeBank.columns.amount'), meta: end },
  { id: 'amount_residual', header: t('financeBank.columns.residual'), meta: end },
  { id: 'state', header: t('financeBank.columns.state') },
  { id: 'actions', header: '', meta: { class: { th: 'w-24', td: 'w-24 text-end' } } },
])
const reconcileTo = (line: FinanceBankLine) => ({ path: reconcilePath(props.record.id, line.id), query: { returnTo: props.record.backTo } })
const showReconcile = (line: FinanceBankLine) => canReconcile.value && !line.is_reconciled
</script>

<template>
  <template v-if="statement">
    <SharedKpiStrip v-if="kpisShown" :tiles="tiles" :label="t('financeBank.summary.label')" data-testid="finance-bank-summary" />
    <SharedRecordSection variant="list" :title="t('financeBank.linesTitle')" data-testid="finance-bank-lines-panel">
      <SharedEmptyState v-if="!statement.lines.length" class="m-(--webvue-card-pad-dense)" :title="t('financeBank.noLines')" />
      <div v-else class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,820px)]">
        <SharedDataTable bare :rows="statement.lines" :columns="columns" row-key="id" :caption="t('financeBank.linesTitle')">
          <template #date-cell="{ row }"><bdi class="tabular-nums">{{ row.original.date }}</bdi></template>
          <template #payment_ref-cell="{ row }"><span class="font-medium text-highlighted" :data-testid="`finance-bank-line-${row.original.id}`">{{ row.original.payment_ref }}</span></template>
          <template #partner-cell="{ row }">{{ row.original.partner?.name ?? dash }}</template>
          <template #amount-cell="{ row }"><Money :amount="row.original.amount" :currency="statement.currency" /></template>
          <template #amount_residual-cell="{ row }"><Money :amount="row.original.amount_residual" :currency="statement.currency" /></template>
          <template #state-cell="{ row }"><SharedStatusBadge size="sm" :tone="BANK_LINE_TONE[lineState(row.original)]" :label="t(`financeBank.lineStates.${lineState(row.original)}`)" /></template>
          <template #actions-cell="{ row }">
            <UButton v-if="showReconcile(row.original)" color="primary" variant="soft" size="sm" :to="reconcileTo(row.original)" :disabled="!hydrated" :label="t('financeBank.reconcile.action')" :aria-label="t('financeBank.reconcile.actionFor', { label: row.original.payment_ref })" :data-testid="`finance-bank-reconcile-${row.original.id}`" />
          </template>
          <template #mobile-row="{ row }">
            <div class="flex min-w-0 flex-col gap-2">
              <span class="flex items-center justify-between gap-2">
                <span class="min-w-0 truncate font-semibold text-highlighted">{{ row.payment_ref }}</span>
                <SharedStatusBadge size="sm" :tone="BANK_LINE_TONE[lineState(row)]" :label="t(`financeBank.lineStates.${lineState(row)}`)" />
              </span>
              <span class="truncate text-sm text-muted"><bdi class="tabular-nums">{{ row.date }}</bdi> · {{ row.partner?.name ?? dash }}</span>
              <span class="flex items-center justify-between gap-2 text-sm">
                <Money :amount="row.amount" :currency="statement.currency" />
                <UButton v-if="showReconcile(row)" color="primary" variant="soft" size="sm" :to="reconcileTo(row)" :disabled="!hydrated" :label="t('financeBank.reconcile.action')" />
              </span>
            </div>
          </template>
        </SharedDataTable>
      </div>
    </SharedRecordSection>
  </template>
</template>
