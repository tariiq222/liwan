<script setup lang="ts">
import InvoiceForm from '@/components/finance/invoices/InvoiceForm.vue'
import InvoiceList from '@/components/finance/invoices/InvoiceList.vue'
import { useInvoiceCreatePage } from '@/components/finance/invoices/useInvoiceCreatePage'

const { t } = useI18n()
const page = useInvoiceCreatePage('out_refund')
</script>

<template>
  <SharedListPage v-bind="page.list.header">
    <template v-if="page.list.allowed" #kpis>
      <SharedKpiStrip v-if="page.list.kpis.shown" :tiles="page.list.kpis.tiles" :loading="page.list.kpis.loading" :label="page.list.kpis.label" data-testid="finance-invoice-kpis" />
    </template>
    <InvoiceList move-type="out_refund" background />
  </SharedListPage>
  <SharedCreatePanel size="wide" :title="page.title" :back-to="page.backTo">
    <InvoiceForm v-if="page.allowed" move-type="out_refund" :back-to="page.backTo" @saved="page.saved" />
    <SharedForbiddenState v-else :description="t('financeDocuments.forbidden')" />
  </SharedCreatePanel>
</template>
