<script setup lang="ts">
import BudgetRecordActions from '@/components/finance/budgets/BudgetRecordActions.vue'
import BudgetRecordAside from '@/components/finance/budgets/BudgetRecordAside.vue'
import BudgetRecordBody from '@/components/finance/budgets/BudgetRecordBody.vue'
import { useBudgetRecord } from '@/components/finance/budgets/useBudgetRecord'

const record = useBudgetRecord()
</script>

<template>
  <SharedRecordPage v-bind="record.header" @retry="record.retry">
    <template v-if="record.budget" #actions><BudgetRecordActions :record="record" /></template>
    <BudgetRecordBody :record="record" />
    <template v-if="record.budget" #aside><BudgetRecordAside :record="record" /></template>
  </SharedRecordPage>
</template>
