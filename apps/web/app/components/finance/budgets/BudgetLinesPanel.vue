<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceBudgetDetail, FinanceBudgetLine } from '@webvue/contracts'
import Money from '../invoices/Money.vue'
import BudgetLineForm from './BudgetLineForm.vue'
import { budgetPeriod } from './budgetPaths'
import { NATURE_TONE } from './budgetTones'

// The lines of a budget: account (with its label and analytic account underneath), nature, period and amount. While
// the budget is a draft and the caller may manage it, the add-line form sits inside the section.
const props = defineProps<{ budget: FinanceBudgetDetail; editable: boolean }>()
const { t } = useI18n()
const numeric = { class: { th: 'text-end', td: 'text-end' } }
const columns = computed<TableColumn<FinanceBudgetLine>[]>(() => [
  { id: 'account', header: t('financeBudgets.lines.account') },
  { id: 'nature', header: t('financeBudgets.lines.nature') },
  { id: 'period', header: t('financeBudgets.columns.period') },
  { id: 'amount', header: t('financeBudgets.lines.amount'), meta: numeric },
])
const detail = (line: FinanceBudgetLine) => [line.label, line.analytic_account?.name].filter(Boolean).join(' · ')
</script>

<template>
  <SharedRecordSection variant="list" :title="t('financeBudgets.lines.title')" data-testid="finance-budget-lines-panel">
    <SharedDataTable bare :rows="budget.lines" :columns="columns" row-key="id" :empty-text="t('financeBudgets.lines.empty')" :caption="t('financeBudgets.lines.title')">
      <template #account-cell="{ row }">
        <span class="block font-semibold text-highlighted">{{ row.original.account.name }}</span>
        <span v-if="detail(row.original)" class="block text-sm text-muted">{{ detail(row.original) }}</span>
      </template>
      <template #nature-cell="{ row }"><SharedStatusBadge size="sm" :tone="NATURE_TONE[row.original.nature]" :label="t(`financeBudgets.nature.${row.original.nature}`)" /></template>
      <template #period-cell="{ row }"><bdi class="tabular-nums">{{ budgetPeriod(row.original) }}</bdi></template>
      <template #amount-cell="{ row }"><Money :amount="row.original.amount" :currency="budget.currency" /></template>
      <template #mobile-row="{ row }">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="font-semibold text-highlighted">{{ row.account.name }}</p>
            <p v-if="detail(row)" class="text-sm text-muted">{{ detail(row) }}</p>
            <p class="flex items-center gap-2 text-sm text-muted">
              <SharedStatusBadge size="sm" :tone="NATURE_TONE[row.nature]" :label="t(`financeBudgets.nature.${row.nature}`)" />
              <bdi class="tabular-nums">{{ budgetPeriod(row) }}</bdi>
            </p>
          </div>
          <Money :amount="row.amount" :currency="budget.currency" />
        </div>
      </template>
    </SharedDataTable>
    <BudgetLineForm v-if="props.editable" :budget="budget" />
  </SharedRecordSection>
</template>
