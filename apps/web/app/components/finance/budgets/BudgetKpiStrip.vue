<script setup lang="ts">
import { useFinanceBudgetSummary } from '@/composables/finance/useFinanceKpis'
import { budgetSummaryParams, budgetKpiTiles, type BudgetKpiCounts, type BudgetListFilters } from './budgetListParams'

const props = defineProps<{ filters: BudgetListFilters }>()
const { t } = useI18n()
const summary = useFinanceBudgetSummary(() => budgetSummaryParams(props.filters))
const counts = computed<BudgetKpiCounts>(() => ({
  total: summary.data.value?.total,
  draft: summary.data.value?.draft,
  confirmed: summary.data.value?.confirmed,
  cancelled: summary.data.value?.cancelled,
}))
const tiles = computed(() => budgetKpiTiles(counts.value, id => t(`financeBudgets.kpi.${id}`)))
const loading = computed(() => summary.data.value === undefined)
</script>

<template>
  <SharedKpiStrip :tiles="tiles" :loading="loading" :label="t('financeBudgets.kpi.label')" data-testid="finance-budget-kpis" />
</template>
