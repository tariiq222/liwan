<script setup lang="ts">
import BudgetForm from '@/components/finance/budgets/BudgetForm.vue'
import BudgetList from '@/components/finance/budgets/BudgetList.vue'
import { useBudgetCreatePage } from '@/components/finance/budgets/useBudgetCreatePage'

const { t } = useI18n()
const page = useBudgetCreatePage()
</script>

<template>
  <SharedListPage v-bind="page.list"><BudgetList background /></SharedListPage>
  <SharedCreatePanel :title="page.title" :back-to="page.backTo">
    <BudgetForm v-if="page.allowed" :back-to="page.backTo" @saved="page.saved" />
    <SharedForbiddenState v-else :description="t('financeBudgets.forbidden')" />
  </SharedCreatePanel>
</template>
