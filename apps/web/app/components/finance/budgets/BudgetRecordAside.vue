<script setup lang="ts">
import { budgetPeriod } from './budgetPaths'
import type { BudgetRecordState } from './useBudgetRecord'

// The aside of a budget's record page: its properties.
defineProps<{ record: BudgetRecordState }>()
const { t } = useI18n()
</script>

<template>
  <SharedPropertiesPanel v-if="record.budget">
    <SharedPropertyRow :label="t('financeBudgets.columns.name')" :value="record.budget.name" />
    <SharedPropertyRow :label="t('financeBudgets.form.description')" :value="record.budget.description || null" />
    <SharedPropertyRow :label="t('financeBudgets.columns.period')"><bdi class="tabular-nums">{{ budgetPeriod(record.budget) }}</bdi></SharedPropertyRow>
    <SharedPropertyRow :label="t('financeBudgets.form.costCenterSplit')" :value="t(record.budget.cost_center_split ? 'financeBudgets.record.yes' : 'financeBudgets.record.no')" />
    <SharedPropertyRow :label="t('financeBudgets.record.currency')" :value="record.budget.currency" />
    <SharedPropertyRow :label="t('financeBudgets.columns.lineCount')" :value="t('financeBudgets.lines.count', { count: record.budget.line_count }, record.budget.line_count)" />
  </SharedPropertiesPanel>
</template>
