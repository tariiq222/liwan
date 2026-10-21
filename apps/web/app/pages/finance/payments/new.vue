<script setup lang="ts">
import PaymentForm from '@/components/finance/payments/PaymentForm.vue'
import StandalonePaymentForm from '@/components/finance/payments/StandalonePaymentForm.vue'
import PaymentList from '@/components/finance/payments/PaymentList.vue'
import { usePaymentCreatePage } from '@/components/finance/payments/usePaymentCreatePage'

const { t } = useI18n()
const page = usePaymentCreatePage()
</script>

<template>
  <SharedListPage v-bind="page.list"><PaymentList background /></SharedListPage>
  <SharedCreatePanel :title="page.title" :back-to="page.backTo">
    <StandalonePaymentForm v-if="page.allowed && page.standalone" :back-to="page.backTo" @saved="page.saved" />
    <PaymentForm v-else-if="page.allowed" :invoice-ids="page.invoiceIds" :back-to="page.backTo" @saved="page.saved" />
    <SharedForbiddenState v-else :description="t('financeDocuments.forbidden')" />
  </SharedCreatePanel>
</template>
