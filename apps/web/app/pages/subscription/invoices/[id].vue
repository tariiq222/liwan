<script setup lang="ts">
import { useCustomerCapabilities, useSubscriptionApi } from '@/composables/useSubscription'
import { subscriptionInvoiceView } from '@/utils/subscription'
const { t, locale } = useI18n(); const route = useRoute(); const api = useSubscriptionApi(); const { can } = useCustomerCapabilities()
const allowed = computed(() => can('billing.read'))
const id = computed(() => String(route.params.id ?? ''))
// Another tenant's invoice id answers 404 from the BFF/control plane; SharedPageState shows "not found", never the data.
const { data, error, pending, refresh } = await useAsyncData(() => `subscription:invoice:${id.value}`, () => api.invoice(id.value), { immediate: allowed.value, watch: [id] })
const view = computed(() => data.value ? subscriptionInvoiceView(data.value, t, locale.value) : null)
definePageMeta({ middleware: 'customer-commercial' })
</script>
<template>
  <SharedRecordPage  :title="data?.number ?? t('subscription.invoices.title')" :description="data ? `${data.period_start} → ${data.period_end}` : undefined" back-to="/subscription/invoices" :back-label="t('subscription.invoices.back')"  :loading="allowed && pending" :error="allowed ? error : undefined" @retry="refresh">

    <SharedForbiddenState v-if="!allowed" />
    <SharedInvoiceLines v-else-if="view" layout="list" v-bind="view" />
  </SharedRecordPage>
</template>
