<script setup lang="ts">
import BudgetList from '@/components/finance/budgets/BudgetList.vue'
import { useBudgetListPage } from '@/components/finance/budgets/useBudgetListPage'

const page = useBudgetListPage()
</script>

<template>
  <SharedListPage v-bind="page.header">
    <template v-if="page.allowed" #kpis>
      <SharedKpiStrip v-if="page.kpis.shown" :tiles="page.kpis.tiles" :loading="page.kpis.loading" :label="page.kpis.label" data-testid="finance-budget-kpis" />
    </template>
    <BudgetList />
  </SharedListPage>
</template>
