<script setup lang="ts">
import BankStatementForm from '@/components/finance/bank/BankStatementForm.vue'
import BankImportForm from '@/components/finance/bank/BankImportForm.vue'
import BankStatementList from '@/components/finance/bank/BankStatementList.vue'
import { useBankCreatePage } from '@/components/finance/bank/useBankCreatePage'

const { t } = useI18n()
const page = useBankCreatePage()
</script>

<template>
  <SharedListPage v-bind="page.list"><BankStatementList background /></SharedListPage>
  <SharedCreatePanel :title="page.title" :back-to="page.backTo">
    <BankImportForm v-if="page.allowed && page.importing" :back-to="page.backTo" @saved="page.saved" />
    <BankStatementForm v-else-if="page.allowed" :back-to="page.backTo" @saved="page.saved" />
    <SharedForbiddenState v-else :description="t('financeBank.forbidden')" />
  </SharedCreatePanel>
</template>
