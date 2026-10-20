<script setup lang="ts">
import { useFinanceBudgetList } from '@/composables/finance/useFinanceBudgets'
import { budgetKpiParams, budgetKpiTiles, type BudgetKpiCounts, type BudgetListFilters } from './budgetListParams'

// The counts above the budgets list: every figure is the total the server reports for the list's own filters
// (the state filter excepted: each tile picks its state), asked for with one row, never counted from the loaded page.
const props = defineProps<{ filters: BudgetListFilters }>()
const { t } = useI18n()
const total = useFinanceBudgetList(() => budgetKpiParams(props.filters, null))
const draft = useFinanceBudgetList(() => budgetKpiParams(props.filters, 'draft'))
const confirmed = useFinanceBudgetList(() => budgetKpiParams(props.filters, 'confirmed'))
const cancelled = useFinanceBudgetList(() => budgetKpiParams(props.filters, 'cancelled'))
const counts = computed<BudgetKpiCounts>(() => ({
  total: total.data.value?.total,
  draft: draft.data.value?.total,
  confirmed: confirmed.data.value?.total,
  cancelled: cancelled.data.value?.total,
}))
const tiles = computed(() => budgetKpiTiles(counts.value, id => t(`financeBudgets.kpi.${id}`)))
const loading = computed(() => Object.values(counts.value).some(count => count === undefined))
</script>

<template>
  <SharedKpiStrip :tiles="tiles" :loading="loading" :label="t('financeBudgets.kpi.label')" data-testid="finance-budget-kpis" />
</template>
