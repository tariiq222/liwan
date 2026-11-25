<script setup lang="ts">
import InvoiceList from '@/components/finance/invoices/InvoiceList.vue'
import { useInvoiceListPage } from '@/components/finance/invoices/useInvoiceListPage'

const page = useInvoiceListPage('in_refund')
</script>

<template>
  <SharedListPage v-bind="page.header">
    <template v-if="page.allowed" #kpis>
      <SharedKpiStrip v-if="page.kpis.shown" :tiles="page.kpis.tiles" :loading="page.kpis.loading" :label="page.kpis.label" data-testid="finance-invoice-kpis" />
    </template>
    <InvoiceList move-type="in_refund" />
  </SharedListPage>
</template>
