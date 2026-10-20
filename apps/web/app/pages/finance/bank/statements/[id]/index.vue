<script setup lang="ts">
import BankStatementAside from '@/components/finance/bank/BankStatementAside.vue'
import BankStatementBody from '@/components/finance/bank/BankStatementBody.vue'
import { useBankStatementRecord } from '@/components/finance/bank/useBankStatementRecord'

const record = useBankStatementRecord()
</script>

<template>
  <SharedRecordPage v-bind="record.header" @retry="record.retry">
    <BankStatementBody :record="record" />
    <template v-if="record.statement" #aside><BankStatementAside :record="record" /></template>
  </SharedRecordPage>
</template>
