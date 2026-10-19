<script setup lang="ts">
import PaymentList from '@/components/finance/payments/PaymentList.vue'
import { usePaymentListPage } from '@/components/finance/payments/usePaymentListPage'

const page = usePaymentListPage()
</script>

<template>
  <SharedListPage v-bind="page"><PaymentList /></SharedListPage>
</template>
