<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceBankLine } from '@webvue/contracts'
import { useDeleteFinanceBankStatement, useUnreconcileFinanceBankLine } from '@/composables/finance/useFinanceBank'
import { financeErrorMessage } from '../financeErrors'
import Money from '../invoices/Money.vue'
import BankAutoMatch from './BankAutoMatch.vue'
import BankStatementEditPanel from './BankStatementEditPanel.vue'
import { bankErrorKey } from './bankErrors'
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
  { id: 'amount', header: t('financeBank.columns.amount'), meta: end },
  { id: 'state', header: t('financeBank.columns.state') },
])
const reconcileTo = (line: FinanceBankLine) => ({ path: reconcilePath(props.record.id, line.id), query: { returnTo: props.record.backTo } })
const unreconcile = useUnreconcileFinanceBankLine()
const undoing = ref<FinanceBankLine | null>(null)
const undoError = ref('')
async function confirmUndo() {
  const line = undoing.value
  if (!line || !hydrated.value || unreconcile.isPending.value) return
  undoError.value = ''
  try {
    await unreconcile.mutateAsync(line.id)
    undoing.value = null
  } catch (cause) {
    undoError.value = financeErrorMessage(cause, bankErrorKey, t)
  }
}
const removal = useDeleteFinanceBankStatement()
async function confirmDelete() {
  if (!hydrated.value || removal.isPending.value) return
  undoError.value = ''
  try {
    await removal.mutateAsync(props.record.id)
    await navigateTo(props.record.backTo, { replace: true })
  } catch (cause) {
    undoError.value = financeErrorMessage(cause, bankErrorKey, t)
  }
}
const hasOpenLines = computed(() => !!statement.value?.lines.some(line => !line.is_reconciled))
const showUndo = (line: FinanceBankLine) => canReconcile.value && line.is_reconciled
const showReconcile = (line: FinanceBankLine) => canReconcile.value && !line.is_reconciled
</script>

<template>
  <template v-if="statement">
    <SharedRecordSection variant="list" :title="t('financeBank.linesTitle')" data-testid="finance-bank-lines-panel">
      <BankStatementEditPanel v-if="record.editing" class="m-(--webvue-card-pad-dense)" :statement="statement" @done="record.editing = false" @cancel="record.editing = false" />
      <SharedInlineConfirm
        v-if="record.deleting"
        class="m-(--webvue-card-pad-dense)"
        :title="t('financeBank.delete.confirm', { name: statement.name })"
        :description="t('financeBank.delete.hint')"
        :confirm-label="t('financeBank.delete.action')"
        color="error"
        :pending="removal.isPending.value"
        :disabled="!hydrated"
        @confirm="confirmDelete"
        @cancel="record.deleting = false"
      />
      <UAlert v-if="undoError" role="alert" color="error" variant="subtle" class="m-(--webvue-card-pad-dense)" :title="undoError" />
      <SharedInlineConfirm
        v-if="undoing"
        class="m-(--webvue-card-pad-dense)"
        :title="t('financeBank.undo.confirm', { label: undoing.payment_ref })"
        :description="t('financeBank.undo.hint')"
        :confirm-label="t('financeBank.undo.action')"
        color="warning"
        :pending="unreconcile.isPending.value"
        :disabled="!hydrated"
        @confirm="confirmUndo"
        @cancel="undoing = null"
      />
      <BankAutoMatch v-if="canReconcile && hasOpenLines" :statement-id="record.id" />
      <SharedEmptyState v-if="!statement.lines.length" class="m-(--webvue-card-pad-dense)" :title="t('financeBank.noLines')" />
      <div v-else class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,560px)]">
        <SharedDataTable bare :rows="statement.lines" :columns="columns" row-key="id" :caption="t('financeBank.linesTitle')">
          <template #date-cell="{ row }"><bdi class="tabular-nums">{{ row.original.date }}</bdi></template>
          <template #payment_ref-cell="{ row }">
            <span class="flex min-w-0 flex-col">
              <span class="truncate font-medium text-highlighted" :data-testid="`finance-bank-line-${row.original.id}`">{{ row.original.payment_ref }}</span>
              <span class="truncate text-xs text-muted">{{ row.original.partner?.name ?? dash }}</span>
            </span>
          </template>
          <template #amount-cell="{ row }"><Money :amount="row.original.amount" :currency="statement.currency" /></template>
          <template #state-cell="{ row }">
            <span class="flex items-center gap-2">
              <SharedStatusBadge size="sm" :tone="BANK_LINE_TONE[lineState(row.original)]" :label="t(`financeBank.lineStates.${lineState(row.original)}`)" />
              <UButton v-if="showUndo(row.original)" color="neutral" variant="ghost" size="sm" icon="i-lucide-undo-2" :disabled="!hydrated || unreconcile.isPending.value" :label="t('financeBank.undo.action')" :aria-label="t('financeBank.undo.actionFor', { label: row.original.payment_ref })" :data-testid="`finance-bank-undo-${row.original.id}`" @click="undoing = row.original" />
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
                <UButton v-if="showUndo(row)" color="neutral" variant="ghost" size="sm" icon="i-lucide-undo-2" :disabled="!hydrated || unreconcile.isPending.value" :label="t('financeBank.undo.action')" @click="undoing = row" />
                <UButton v-if="showReconcile(row)" color="primary" variant="soft" size="sm" :to="reconcileTo(row)" :disabled="!hydrated" :label="t('financeBank.reconcile.action')" />
              </span>
            </div>
          </template>
        </SharedDataTable>
      </div>
    </SharedRecordSection>
  </template>
</template>
