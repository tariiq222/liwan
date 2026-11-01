<script setup lang="ts">
import PaymentList from '@/components/finance/payments/PaymentList.vue'
import TransferForm from '@/components/finance/payments/TransferForm.vue'
import { usePaymentCreatePage } from '@/components/finance/payments/usePaymentCreatePage'

const { t } = useI18n()
const page = usePaymentCreatePage('transfer')
</script>

<template>
  <SharedListPage v-bind="page.list"><PaymentList background /></SharedListPage>
  <SharedCreatePanel :title="page.title" :back-to="page.backTo">
    <TransferForm v-if="page.allowed" :back-to="page.backTo" />
    <SharedForbiddenState v-else :description="t('financeDocuments.forbidden')" />
  </SharedCreatePanel>
</template>
