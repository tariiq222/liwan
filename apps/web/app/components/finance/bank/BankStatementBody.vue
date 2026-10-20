<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceBankLine } from '@webvue/contracts'
import Money from '../invoices/Money.vue'
import { BANK_LINE_TONE, lineState, reconcilePath } from './bankModel'
import type { BankStatementRecordState } from './useBankStatementRecord'

// The main column of a statement's record page: the lines with their reconciliation state; an open line links to its
// reconciliation page, next to its state, for a caller who may reconcile.
const props = defineProps<{ record: BankStatementRecordState }>()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const statement = computed(() => props.record.statement)
const canReconcile = computed(() => can('finance.bank.manage'))
const dash = computed(() => t('app.notAvailable'))

const end = { class: { th: 'text-end', td: 'text-end' } }
const columns = computed<TableColumn<FinanceBankLine>[]>(() => [
  { id: 'date', header: t('financeBank.columns.date') },
  { id: 'payment_ref', header: t('financeBank.columns.label') },
  { id: 'partner', header: t('financeBank.columns.partner') },
  { id: 'amount', header: t('financeBank.columns.amount'), meta: end },
  { id: 'amount_residual', header: t('financeBank.columns.residual'), meta: end },
  { id: 'state', header: t('financeBank.columns.state') },
])
const reconcileTo = (line: FinanceBankLine) => ({ path: reconcilePath(props.record.id, line.id), query: { returnTo: props.record.backTo } })
const showReconcile = (line: FinanceBankLine) => canReconcile.value && !line.is_reconciled
</script>

<template>
  <template v-if="statement">
    <SharedRecordSection variant="list" :title="t('financeBank.linesTitle')" data-testid="finance-bank-lines-panel">
      <SharedEmptyState v-if="!statement.lines.length" class="m-(--webvue-card-pad-dense)" :title="t('financeBank.noLines')" />
      <div v-else class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,680px)]">
        <SharedDataTable bare :rows="statement.lines" :columns="columns" row-key="id" :caption="t('financeBank.linesTitle')">
          <template #date-cell="{ row }"><bdi class="tabular-nums">{{ row.original.date }}</bdi></template>
          <template #payment_ref-cell="{ row }"><span class="font-medium text-highlighted" :data-testid="`finance-bank-line-${row.original.id}`">{{ row.original.payment_ref }}</span></template>
          <template #partner-cell="{ row }">{{ row.original.partner?.name ?? dash }}</template>
          <template #amount-cell="{ row }"><Money :amount="row.original.amount" :currency="statement.currency" /></template>
          <template #amount_residual-cell="{ row }"><Money :amount="row.original.amount_residual" :currency="statement.currency" /></template>
          <template #state-cell="{ row }">
            <span class="flex items-center gap-2">
              <SharedStatusBadge size="sm" :tone="BANK_LINE_TONE[lineState(row.original)]" :label="t(`financeBank.lineStates.${lineState(row.original)}`)" />
              <UButton v-if="showReconcile(row.original)" color="primary" variant="soft" size="sm" :to="reconcileTo(row.original)" :disabled="!hydrated" :label="t('financeBank.reconcile.action')" :aria-label="t('financeBank.reconcile.actionFor', { label: row.original.payment_ref })" :data-testid="`finance-bank-reconcile-${row.original.id}`" />
            </span>
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
