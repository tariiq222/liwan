<script setup lang="ts">
import BankStatementList from '@/components/finance/bank/BankStatementList.vue'
import { useBankListPage } from '@/components/finance/bank/useBankListPage'

const page = useBankListPage()
</script>

<template>
  <SharedListPage v-bind="page"><BankStatementList /></SharedListPage>
</template>
