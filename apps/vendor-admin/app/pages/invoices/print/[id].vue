<script setup lang="ts">
import { invoicePrintable, invoicesReturnTo } from '@/utils/vendorSubscriptions'
import { useVendorSubscriptions } from '@/composables/useVendorSubscriptions'
// A print-ready page: the browser saves it as a PDF (Arabic shaping and direction come from the browser). It draws the document the
// customer prints (the shared SharedInvoiceDocument), from a read that carries no operator text; the vendor prints exactly what the customer prints.
definePageMeta({ capability: 'vendor.billing.manage' })
const { t } = useI18n(); const route = useRoute(); const api = useVendorSubscriptions()
const hydrated = useHydrated()
const id = computed(() => String(route.params.id))
const backTo = computed(() => ({ path: `/invoices/${encodeURIComponent(id.value)}`, query: { returnTo: invoicesReturnTo(route.query.returnTo) } }))
const { data, error, pending, refresh } = await useAsyncData(() => `vendor:invoice-document:${id.value}`, () => api.invoiceDocument(id.value))
const printable = computed(() => (data.value ? invoicePrintable(data.value) : false))
function printPage() {
  if (hydrated.value && import.meta.client) window.print()
}
</script>
<template>
  <SharedStandalonePage variant="print">
    <h1 class="sr-only">{{ t('vendor.invoices.print.title') }}</h1>
    <SharedPageState empty-icon="i-lucide-receipt-text" :loading="pending" :error="error" :empty="!data" :empty-text="t('vendor.invoices.notAvailable')" @retry="refresh">
      <SharedEmptyState v-if="data && !printable" :title="t('vendor.invoices.print.draft')" icon="i-lucide-receipt-text" />
      <SharedInvoiceDocument v-else-if="data" :invoice="data" />
    </SharedPageState>
    <template #footer>
      <UButton color="neutral" variant="outline" :to="backTo" :label="t('vendor.invoices.print.back')" data-testid="invoice-print-back" />
      <UButton v-if="printable" type="button" icon="i-lucide-printer" :disabled="!hydrated" :label="t('vendor.invoices.print.action')" data-testid="invoice-print-action" @click="printPage" />
    </template>
  </SharedStandalonePage>
</template>
