<script setup lang="ts">
import FinanceRecordHero from '@/components/finance/FinanceRecordHero.vue'
import InvoiceRecordActions from '@/components/finance/invoices/InvoiceRecordActions.vue'
import InvoiceRecordAside from '@/components/finance/invoices/InvoiceRecordAside.vue'
import InvoiceRecordBody from '@/components/finance/invoices/InvoiceRecordBody.vue'
import { INVOICE_STATE_TONE } from '@/components/finance/invoices/invoiceTones'
import { useInvoiceRecord } from '@/components/finance/invoices/useInvoiceRecord'

const { t } = useI18n()
const record = useInvoiceRecord('in_invoice')
</script>

<template>
  <SharedRecordPage v-bind="record.header" @retry="record.retry">
    <template v-if="record.invoice" #actions><InvoiceRecordActions :record="record" /></template>
    <template v-if="record.invoice" #summary>
      <FinanceRecordHero
        icon="i-lucide-file-text"
        :tone="INVOICE_STATE_TONE[record.invoice.state]"
        :title="record.title"
        :status="t(`financeDocuments.states.${record.invoice.state}`)"
        :amount="record.invoice.state === 'posted'
          ? { label: t('financeDocuments.record.residual'), value: record.invoice.amount_residual, currency: record.invoice.currency }
          : { label: t('financeDocuments.record.total'), value: record.invoice.amount_total, currency: record.invoice.currency }"
        data-testid="finance-invoice-hero"
      />
    </template>
    <InvoiceRecordBody :record="record" move-type="in_invoice" />
    <template v-if="record.invoice" #aside><InvoiceRecordAside :record="record" move-type="in_invoice" /></template>
  </SharedRecordPage>
</template>
