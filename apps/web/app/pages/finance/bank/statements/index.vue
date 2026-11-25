<script setup lang="ts">
import BankStatementList from '@/components/finance/bank/BankStatementList.vue'
import { useBankListPage } from '@/components/finance/bank/useBankListPage'

const page = useBankListPage()
</script>

<template>
  <SharedListPage v-bind="page.header">
    <template v-if="page.allowed" #kpis>
      <SharedKpiStrip v-if="page.kpis.shown && !page.kpis.error" :tiles="page.kpis.tiles" :loading="page.kpis.loading" :label="page.kpis.label" data-testid="finance-bank-kpis" />
    </template>
    <BankStatementList />
  </SharedListPage>
</template>
