<script setup lang="ts">
import type { InvoiceRecordState } from './useInvoiceRecord'

// The header actions of a document's record page: the one that moves it forward, edit, the PDF and a menu for the rest.
defineProps<{ record: InvoiceRecordState }>()
const { t } = useI18n()
</script>

<template>
  <template v-if="record.actions">
    <UButton v-if="record.actions.post && !record.editing" color="primary" icon="i-lucide-check" :loading="record.posting" :disabled="!record.hydrated || record.busy" :label="t('financeDocuments.actions.post')" data-testid="finance-invoice-post" @click="record.change('post')" />
    <UButton v-if="record.actions.registerPayment" color="primary" icon="i-lucide-banknote" :to="record.paymentTo" :disabled="!record.hydrated || record.busy" :label="t('financeDocuments.actions.registerPayment')" data-testid="finance-invoice-register-payment" />
    <UButton v-if="record.actions.edit && !record.editing" color="neutral" variant="outline" icon="i-lucide-pencil" :disabled="!record.hydrated || record.busy" :label="t('app.edit')" data-testid="finance-invoice-edit" @click="record.editing = true" />
    <UButton v-if="record.actions.pdf" color="neutral" variant="outline" icon="i-lucide-download" :href="record.pdfHref" external :label="t('financeDocuments.actions.pdf')" data-testid="finance-invoice-pdf" />
    <SharedRowActions v-if="record.menu.length" :actions="record.menu" :label="t('financeDocuments.actions.menuFor', { name: record.title })" :disabled="record.busy" />
  </template>
</template>
