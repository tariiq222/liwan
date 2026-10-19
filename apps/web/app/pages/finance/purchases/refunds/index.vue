<script setup lang="ts">
import InvoiceList from '@/components/finance/invoices/InvoiceList.vue'
import { useInvoiceListPage } from '@/components/finance/invoices/useInvoiceListPage'

const page = useInvoiceListPage('in_refund')
</script>

<template>
  <SharedListPage v-bind="page"><InvoiceList move-type="in_refund" /></SharedListPage>
</template>
