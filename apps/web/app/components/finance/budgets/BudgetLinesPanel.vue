<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceBudgetDetail, FinanceBudgetLine } from '@liwan/contracts'
import type { RowAction } from '@liwan/ui/app/components/shared/data/RowActions.vue'
import { h } from 'vue'
import { useDeleteFinanceBudgetLine } from '@/composables/finance/useFinanceBudgets'
import Money from '../invoices/Money.vue'
import { financeErrorMessage } from '../financeErrors'
import BudgetDistributeForm from './BudgetDistributeForm.vue'
import { budgetErrorKey } from './budgetErrors'
import BudgetLineForm from './BudgetLineForm.vue'
import { budgetPeriod } from './budgetPaths'
import { NATURE_TONE } from './budgetTones'

// The lines of a budget: account (with its label and analytic account underneath), nature, period and amount. While
// the budget is a draft and the caller may manage it, each line can be edited or deleted (confirmed inline), and the
// add-line form and the split between cost centers sit inside the section.
const props = defineProps<{ budget: FinanceBudgetDetail; editable: boolean }>()
const { t } = useI18n()
const hydrated = useHydrated()
const splitting = ref(false)
type LinePanel = { kind: 'edit' | 'delete'; line: FinanceBudgetLine }
const panel = ref<LinePanel | null>(null)
const removal = useDeleteFinanceBudgetLine()
const error = ref('')
const numeric = { class: { th: 'text-end', td: 'text-end' } }
const columns = computed<TableColumn<FinanceBudgetLine>[]>(() => [
  { id: 'account', header: t('financeBudgets.lines.account') },
  { id: 'nature', header: t('financeBudgets.lines.nature') },
  { id: 'period', header: t('financeBudgets.columns.period') },
  { id: 'amount', header: t('financeBudgets.lines.amount'), meta: numeric },
  ...(props.editable ? [{ id: 'actions', header: () => h('span', { class: 'sr-only' }, t('app.actions')), meta: { class: { th: 'w-0', td: 'w-0 text-end' } } }] : []),
])
const detail = (line: FinanceBudgetLine) => [line.label, line.analytic_account?.name].filter(Boolean).join(' · ')
const actions = (line: FinanceBudgetLine): RowAction[] => [
  { label: t('financeBudgets.lines.edit'), icon: 'i-lucide-pencil', onSelect: () => open({ kind: 'edit', line }) },
  { label: t('financeBudgets.lines.delete'), icon: 'i-lucide-trash-2', destructive: true, onSelect: () => open({ kind: 'delete', line }) },
]

function open(next: LinePanel) {
  error.value = ''
  splitting.value = false
  panel.value = next
}

async function remove(line: FinanceBudgetLine) {
  if (!hydrated.value || removal.isPending.value) return
  error.value = ''
  try {
    await removal.mutateAsync({ budgetId: props.budget.id, lineId: line.id })
    panel.value = null
  } catch (cause) {
    error.value = financeErrorMessage(cause, budgetErrorKey, t)
  }
}
</script>

<template>
  <SharedRecordSection variant="list" :title="t('financeBudgets.lines.title')" data-testid="finance-budget-lines-panel">
    <UAlert v-if="error" role="alert" color="error" variant="subtle" :title="error" class="m-(--liwan-card-pad-dense)" data-testid="finance-budget-line-delete-error" />
    <SharedInlineConfirm
      v-if="editable && panel?.kind === 'delete'"
      :title="t('financeBudgets.lines.confirmDelete', { name: panel.line.account.name })"
      :description="t('financeBudgets.lines.confirmDeleteHint')"
      :confirm-label="t('financeBudgets.lines.delete')"
      :pending="removal.isPending.value"
      :disabled="!hydrated"
      color="error"
      @confirm="remove(panel.line)"
      @cancel="panel = null"
    />
    <SharedDataTable bare :rows="budget.lines" :columns="columns" row-key="id" :empty-text="t('financeBudgets.lines.empty')" :caption="t('financeBudgets.lines.title')">
      <template #account-cell="{ row }">
        <span class="block font-semibold text-highlighted">{{ row.original.account.name }}</span>
        <span v-if="detail(row.original)" class="block text-sm text-muted">{{ detail(row.original) }}</span>
      </template>
      <template #nature-cell="{ row }"><SharedStatusBadge size="sm" :tone="NATURE_TONE[row.original.nature]" :label="t(`financeBudgets.nature.${row.original.nature}`)" /></template>
      <template #period-cell="{ row }"><bdi class="tabular-nums">{{ budgetPeriod(row.original) }}</bdi></template>
      <template #amount-cell="{ row }"><Money :amount="row.original.amount" :currency="budget.currency" /></template>
      <template #actions-cell="{ row }">
        <SharedRowActions :actions="actions(row.original)" :label="t('financeBudgets.lines.actionsFor', { name: row.original.account.name })" :disabled="!hydrated || panel !== null" />
      </template>
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
          <div class="flex items-center gap-2">
            <Money :amount="row.amount" :currency="budget.currency" />
            <SharedRowActions v-if="editable" :actions="actions(row)" :label="t('financeBudgets.lines.actionsFor', { name: row.account.name })" :disabled="!hydrated || panel !== null" />
          </div>
        </div>
      </template>
    </SharedDataTable>
    <BudgetLineForm v-if="props.editable && panel?.kind === 'edit'" :key="panel.line.id" :budget="budget" :line="panel.line" @done="panel = null" @cancel="panel = null" />
    <template v-else-if="props.editable">
      <BudgetDistributeForm v-if="splitting" :budget="budget" @done="splitting = false" @cancel="splitting = false" />
      <div v-else class="border-t border-default p-(--liwan-card-pad-dense)">
        <UButton color="neutral" variant="outline" icon="i-lucide-split" :label="t('financeBudgets.distribute.open')" data-testid="finance-budget-distribute-open" @click="splitting = true" />
      </div>
      <BudgetLineForm :budget="budget" />
    </template>
  </SharedRecordSection>
</template>
