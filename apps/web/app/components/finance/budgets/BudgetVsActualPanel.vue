<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceBudgetVsActual } from '@webvue/contracts'
import { useFinanceBudgetVsActual } from '@/composables/finance/useFinanceBudgets'
import Money from '../invoices/Money.vue'
import { formatAmount } from '../invoices/formatAmount'
import { formatPercent, sideTone, type FigureTone } from './budgetFigures'

type ActualLine = FinanceBudgetVsActual['lines'][number]

// The budget against the posted actuals, to the end of its period: one row per line, then the debit side, the credit
// side and their net as compact tiles. Debit and credit lines are never added together; the server says which.
const props = defineProps<{ budgetId: number }>()
const { t } = useI18n()
const query = useFinanceBudgetVsActual(() => props.budgetId)
const report = computed(() => query.data.value)
const numeric = { class: { th: 'text-end', td: 'text-end' } }
const columns = computed<TableColumn<ActualLine>[]>(() => [
  { id: 'account', header: t('financeBudgets.lines.account') },
  { id: 'budget', header: t('financeBudgets.actual.budget'), meta: numeric },
  { id: 'actual', header: t('financeBudgets.actual.actual'), meta: numeric },
  { id: 'variance', header: t('financeBudgets.actual.variance'), meta: numeric },
  { id: 'favorable', header: t('financeBudgets.actual.result') },
])
const percent = (line: ActualLine) => formatPercent(line.variance_percent) ?? t('app.notAvailable')
const result = (line: ActualLine) => t(`financeBudgets.actual.${line.favorable ? 'favorable' : 'unfavorable'}`)
const resultTone = (line: ActualLine) => line.favorable ? 'success' : 'destructive'
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
    <SharedPageState :error="query.error.value" :keep-content="!!report" @retry="query.refetch">
      <template v-if="report">
        <div class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,560px)]">
          <SharedDataTable bare :rows="report.lines" :columns="columns" row-key="id" :loading="query.isPending.value" :empty-text="t('financeBudgets.lines.empty')" :caption="t('financeBudgets.actual.title')">
            <template #account-cell="{ row }">
              <span class="block font-semibold text-highlighted">{{ row.original.account.name }}</span>
              <span v-if="row.original.label" class="block text-sm text-muted">{{ row.original.label }}</span>
            </template>
            <template #budget-cell="{ row }"><Money :amount="row.original.budget" /></template>
            <template #actual-cell="{ row }"><Money :amount="row.original.actual" /></template>
            <template #variance-cell="{ row }">
              <Money :amount="row.original.variance" />
              <span class="block text-sm text-muted"><bdi class="tabular-nums">{{ percent(row.original) }}</bdi></span>
            </template>
            <template #favorable-cell="{ row }"><SharedStatusBadge size="sm" :tone="resultTone(row.original)" :label="result(row.original)" /></template>
            <template #mobile-row="{ row }">
              <div class="grid gap-2">
                <div class="flex items-start justify-between gap-3">
                  <span class="min-w-0 font-semibold text-highlighted">{{ row.account.name }}</span>
                  <SharedStatusBadge size="sm" :tone="resultTone(row)" :label="result(row)" />
                </div>
                <dl class="grid grid-cols-3 gap-2 text-sm">
                  <div><dt class="text-muted">{{ t('financeBudgets.actual.budget') }}</dt><dd><Money :amount="row.budget" /></dd></div>
                  <div><dt class="text-muted">{{ t('financeBudgets.actual.actual') }}</dt><dd><Money :amount="row.actual" /></dd></div>
                  <div><dt class="text-muted">{{ t('financeBudgets.actual.variance') }}</dt><dd><Money :amount="row.variance" /></dd></div>
                </dl>
              </div>
            </template>
          </SharedDataTable>
        </div>
        <div class="grid gap-3 border-t border-default p-(--webvue-card-pad) sm:grid-cols-3" data-testid="finance-budget-actual-totals">
          <SharedMetricTile v-for="tile in tiles" :key="tile.id" density="compact" :label="tile.label" :value="tile.value" :hint="tile.hint" :tone="tile.tone" value-dir="ltr" />
        </div>
      </template>
    </SharedPageState>
  </SharedRecordSection>
</template>
