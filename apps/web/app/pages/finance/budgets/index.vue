<script setup lang="ts">
import BudgetList from '@/components/finance/budgets/BudgetList.vue'
import { useBudgetListPage } from '@/components/finance/budgets/useBudgetListPage'

const page = useBudgetListPage()
</script>

<template>
  <SharedListPage v-bind="page"><BudgetList /></SharedListPage>
</template>
