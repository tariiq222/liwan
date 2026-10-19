<script setup lang="ts">
import InvoiceRecordActions from '@/components/finance/invoices/InvoiceRecordActions.vue'
import InvoiceRecordAside from '@/components/finance/invoices/InvoiceRecordAside.vue'
import InvoiceRecordBody from '@/components/finance/invoices/InvoiceRecordBody.vue'
import { useInvoiceRecord } from '@/components/finance/invoices/useInvoiceRecord'

const record = useInvoiceRecord('out_invoice')
</script>

<template>
  <SharedRecordPage v-bind="record.header" @retry="record.retry">
    <template v-if="record.invoice" #actions><InvoiceRecordActions :record="record" /></template>
    <InvoiceRecordBody :record="record" move-type="out_invoice" />
    <template v-if="record.invoice" #aside><InvoiceRecordAside :record="record" move-type="out_invoice" /></template>
  </SharedRecordPage>
</template>
