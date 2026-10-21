<script setup lang="ts">
import BankStatementActions from '@/components/finance/bank/BankStatementActions.vue'
import BankStatementAside from '@/components/finance/bank/BankStatementAside.vue'
import BankStatementBody from '@/components/finance/bank/BankStatementBody.vue'
import { useBankStatementRecord } from '@/components/finance/bank/useBankStatementRecord'

const record = useBankStatementRecord()
</script>

<template>
  <SharedRecordPage v-bind="record.header" @retry="record.retry">
    <template v-if="record.statement" #actions><BankStatementActions :record="record" /></template>
    <BankStatementBody :record="record" />
    <template v-if="record.statement" #aside><BankStatementAside :record="record" /></template>
  </SharedRecordPage>
</template>
