<script setup lang="ts">
import { useFinanceBudgetVsActual } from '@/composables/finance/useFinanceBudgets'
import { formatAmount } from '../invoices/formatAmount'
import BudgetVarianceTable from './BudgetVarianceTable.vue'
import { sideTone, type FigureTone } from './budgetFigures'

// The budget against the posted actuals, to the end of its period: one row per line, then the debit side, the credit
// side and their net as compact tiles. Debit and credit lines are never added together; the server says which.
const props = defineProps<{ budgetId: number }>()
const { t } = useI18n()
const query = useFinanceBudgetVsActual(() => props.budgetId)
const report = computed(() => query.data.value)
const money = (amount: number) => `${formatAmount(amount)} ${report.value?.currency ?? ''}`.trim()
const tiles = computed(() => {
  const totals = report.value?.totals
  if (!totals) return []
  const tile = (id: 'debit' | 'credit' | 'net', label: string, figures: { budget: number; actual: number }, tone: FigureTone) => ({
    id,
    label,
    value: money(figures.actual),
    hint: t('financeBudgets.actual.budgetOf', { amount: money(figures.budget) }),
    tone,
  })
  return [
    tile('debit', t('financeBudgets.actual.debitSide'), totals.debit, sideTone('debit', totals.debit)),
    tile('credit', t('financeBudgets.actual.creditSide'), totals.credit, sideTone('credit', totals.credit)),
    tile('net', t('financeBudgets.actual.net'), totals.net, 'neutral'),
  ]
})
</script>

<template>
  <SharedRecordSection variant="list" :title="t('financeBudgets.actual.title')" :description="t('financeBudgets.actual.description')" data-testid="finance-budget-actual-panel">
    <template #actions>
      <UButton :to="`/finance/reports/budget-vs-actual?budget_id=${budgetId}`" color="neutral" variant="outline" size="sm" icon="i-lucide-external-link" :label="t('financeBudgets.actual.openReport')" />
    </template>
    <SharedPageState :error="query.error.value" :keep-content="!!report" @retry="query.refetch">
      <template v-if="report">
        <BudgetVarianceTable :lines="report.lines" :loading="query.isPending.value" :caption="t('financeBudgets.actual.title')" />
        <div class="grid gap-3 border-t border-default p-(--liwan-card-pad) sm:grid-cols-3" data-testid="finance-budget-actual-totals">
          <SharedMetricTile v-for="tile in tiles" :key="tile.id" density="compact" :label="tile.label" :value="tile.value" :hint="tile.hint" :tone="tile.tone" value-dir="ltr" />
        </div>
      </template>
    </SharedPageState>
  </SharedRecordSection>
</template>
