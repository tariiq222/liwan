<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceBudgetVsActual } from '@liwan/contracts'
import Money from '../invoices/Money.vue'
import { formatPercent } from './budgetFigures'

type ActualLine = FinanceBudgetVsActual['lines'][number]

// One row per budget line against its posted actual: budget, actual, the variance with its percent, and whether the
// server calls it favorable. Used by the budget record and by the budget-versus-actual report.
const props = defineProps<{ lines: ActualLine[]; caption: string; loading?: boolean }>()
const { t } = useI18n()
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
</script>

<template>
  <div class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,560px)]">
    <SharedDataTable bare :rows="props.lines" :columns="columns" row-key="id" :loading="props.loading" :empty-text="t('financeBudgets.lines.empty')" :caption="props.caption">
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
</template>
