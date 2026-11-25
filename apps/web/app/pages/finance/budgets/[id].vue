<script setup lang="ts">
import FinanceRecordHero from '@/components/finance/FinanceRecordHero.vue'
import BudgetRecordActions from '@/components/finance/budgets/BudgetRecordActions.vue'
import BudgetRecordAside from '@/components/finance/budgets/BudgetRecordAside.vue'
import BudgetRecordBody from '@/components/finance/budgets/BudgetRecordBody.vue'
import { BUDGET_STATE_TONE } from '@/components/finance/budgets/budgetTones'
import { useBudgetRecord } from '@/components/finance/budgets/useBudgetRecord'

const { t } = useI18n()
const record = useBudgetRecord()
</script>

<template>
  <SharedRecordPage v-bind="record.header" @retry="record.retry">
    <template v-if="record.budget" #actions><BudgetRecordActions :record="record" /></template>
    <template v-if="record.budget" #summary>
      <FinanceRecordHero
        icon="i-lucide-target"
        :tone="BUDGET_STATE_TONE[record.budget.state]"
        :title="record.title"
        :status="t(`financeBudgets.states.${record.budget.state}`)"
        data-testid="finance-budget-hero"
      />
    </template>
    <BudgetRecordBody :record="record" />
    <template v-if="record.budget" #aside><BudgetRecordAside :record="record" /></template>
  </SharedRecordPage>
</template>
