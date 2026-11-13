<script setup lang="ts">
import { useCustomerCapabilities, useSubscriptionApi } from '@/composables/useSubscription'
import InvoiceDocument from '@/components/subscription/InvoiceDocument.vue'
// A print-ready page: the browser saves it as a PDF (Arabic shaping and RTL come from the browser), and all data
// comes through the same commercial proxy as the invoice page.
const { t } = useI18n(); const route = useRoute(); const api = useSubscriptionApi(); const { can } = useCustomerCapabilities()
const hydrated = useHydrated()
const allowed = computed(() => can('billing.read'))
const id = computed(() => String(route.params.id ?? ''))
const backTo = computed(() => `/subscription/invoices/${encodeURIComponent(id.value)}`)
const { data, error, pending, refresh } = await useAsyncData(() => `subscription:invoice:${id.value}`, () => api.invoice(id.value), { immediate: allowed.value, watch: [id] })
usePageHeader(() => data.value?.number ?? t('subscription.invoices.print.title'))
useEscapeBack(() => backTo.value)
function printPage() {
  if (hydrated.value && import.meta.client) window.print()
}
definePageMeta({ middleware: 'customer-commercial' })
</script>
<template>
  <SharedStandalonePage variant="print">
    <h1 class="sr-only">{{ t('subscription.invoices.print.title') }}</h1>
    <SharedForbiddenState v-if="!allowed" />
    <SharedPageState v-else :loading="pending" :error="error" :empty="!data" :empty-text="t('subscription.invoices.empty')" @retry="refresh">
      <InvoiceDocument v-if="data" :invoice="data" />
    </SharedPageState>
    <template #footer>
      <UButton color="neutral" variant="outline" :to="backTo" :label="t('app.back')" data-testid="invoice-print-back" />
      <UButton v-if="allowed" type="button" icon="i-lucide-printer" :disabled="!hydrated || !data" :label="t('subscription.invoices.print.action')" data-testid="invoice-print-action" @click="printPage" />
    </template>
  </SharedStandalonePage>
</template>
