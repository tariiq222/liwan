<script setup lang="ts">
import InvoiceForm from '@/components/finance/invoices/InvoiceForm.vue'
import InvoiceList from '@/components/finance/invoices/InvoiceList.vue'
import { useInvoiceCreatePage } from '@/components/finance/invoices/useInvoiceCreatePage'

const { t } = useI18n()
const page = useInvoiceCreatePage('out_invoice')
</script>

<template>
  <SharedListPage v-bind="page.list"><InvoiceList move-type="out_invoice" background /></SharedListPage>
  <SharedCreatePanel :title="page.title" :back-to="page.backTo">
    <InvoiceForm v-if="page.allowed" move-type="out_invoice" :back-to="page.backTo" @saved="page.saved" />
    <SharedForbiddenState v-else :description="t('financeDocuments.forbidden')" />
  </SharedCreatePanel>
</template>
