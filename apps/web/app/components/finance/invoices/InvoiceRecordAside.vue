<script setup lang="ts">
import type { FinanceMoveType } from './invoiceKinds'
import InvoiceZatcaPanel from './InvoiceZatcaPanel.vue'
import Money from './Money.vue'
import type { InvoiceRecordState } from './useInvoiceRecord'

// The aside of a document's record page: its properties, and the ZATCA standing of a Saudi sale document.
defineProps<{ record: InvoiceRecordState; moveType: FinanceMoveType }>()
const { t } = useI18n()
</script>

<template>
  <template v-if="record.invoice">
    <SharedPropertiesPanel>
      <SharedPropertyRow :label="t(`financeDocuments.kinds.${moveType}.partner`)" :value="record.invoice.partner?.name ?? null" />
      <SharedPropertyRow :label="t('financeDocuments.columns.number')"><bdi>{{ record.invoice.name ?? t('financeDocuments.draftNumber') }}</bdi></SharedPropertyRow>
      <SharedPropertyRow :label="t('financeDocuments.record.journal')" :value="record.invoice.journal.name" />
      <SharedPropertyRow :label="t('financeDocuments.columns.date')"><bdi class="tabular-nums">{{ record.invoice.invoice_date ?? t('app.notAvailable') }}</bdi></SharedPropertyRow>
      <SharedPropertyRow :label="t('financeDocuments.columns.dueDate')"><bdi class="tabular-nums">{{ record.invoice.invoice_date_due ?? t('app.notAvailable') }}</bdi></SharedPropertyRow>
      <SharedPropertyRow :label="t('financeDocuments.form.ref')" :value="record.invoice.ref || null" />
      <SharedPropertyRow :label="t('financeDocuments.record.currency')" :value="record.invoice.currency" />
      <SharedPropertyRow v-if="record.invoice.state === 'posted'" :label="t('financeDocuments.record.residual')"><Money :amount="record.invoice.amount_residual" :currency="record.invoice.currency" /></SharedPropertyRow>
      <SharedPropertyRow v-if="record.invoice.debit_origin && record.debitOriginTo" :label="t('financeDocuments.record.debitOrigin')"><NuxtLink :to="record.debitOriginTo" class="font-semibold text-primary hover:underline"><bdi>{{ record.invoice.debit_origin.name }}</bdi></NuxtLink></SharedPropertyRow>
      <SharedPropertyRow v-if="record.invoice.credit_origin && record.creditOriginTo" :label="t('financeDocuments.record.creditOrigin')"><NuxtLink :to="record.creditOriginTo" class="font-semibold text-primary hover:underline"><bdi>{{ record.invoice.credit_origin.name }}</bdi></NuxtLink></SharedPropertyRow>
    </SharedPropertiesPanel>
    <InvoiceZatcaPanel v-if="record.invoice.zatca" :zatca="record.invoice.zatca" />
  </template>
</template>
