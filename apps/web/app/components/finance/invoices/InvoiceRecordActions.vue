<script setup lang="ts">
import type { InvoiceRecordState } from './useInvoiceRecord'

// The header actions of a document's record page: the one that moves it forward, edit, the PDF and a menu for the rest.
defineProps<{ record: InvoiceRecordState }>()
const { t } = useI18n()
</script>

<template>
  <template v-if="record.actions">
    <UButton v-if="record.actions.offers('post') && !record.editing" color="primary" icon="i-lucide-check" :loading="record.posting" :disabled="!record.hydrated || record.busy || !record.actions.can('post')" :label="t('financeDocuments.actions.post')" data-testid="finance-invoice-post" @click="record.change('post')" />
    <UButton v-if="record.actions.offers('register_payment')" color="primary" icon="i-lucide-banknote" :to="record.paymentTo" :disabled="!record.hydrated || record.busy || !record.actions.can('register_payment')" :label="t('financeDocuments.actions.registerPayment')" data-testid="finance-invoice-register-payment" />
    <UButton v-if="record.actions.offers('edit') && !record.editing" color="neutral" variant="outline" icon="i-lucide-pencil" :disabled="!record.hydrated || record.busy || !record.actions.can('edit')" :label="t('app.edit')" data-testid="finance-invoice-edit" @click="record.editing = true" />
    <UButton v-if="record.actions.can('pdf')" color="neutral" variant="outline" icon="i-lucide-download" :href="record.pdfHref" external :label="t('financeDocuments.actions.pdf')" data-testid="finance-invoice-pdf" />
    <SharedRowActions v-if="record.menu.length" :actions="record.menu" :label="t('financeDocuments.actions.menuFor', { name: record.title })" :disabled="record.busy" />
  </template>
</template>
