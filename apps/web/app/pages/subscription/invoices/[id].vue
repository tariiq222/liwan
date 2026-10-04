<script setup lang="ts">
import SettingsLayout from '@/components/settings/SettingsLayout.vue'
import { useCustomerCapabilities, useSubscriptionApi } from '@/composables/useSubscription'
const { t } = useI18n(); const route = useRoute(); const api = useSubscriptionApi(); const { can } = useCustomerCapabilities()
const allowed = computed(() => can('billing.read'))
const id = computed(() => String(route.params.id ?? ''))
// Another tenant's invoice id answers 404 from the BFF/control plane; SharedPageState shows "not found", never the data.
const { data, error, pending, refresh } = await useAsyncData(() => `subscription:invoice:${id.value}`, () => api.invoice(id.value), { immediate: allowed.value, watch: [id] })
definePageMeta({ middleware: 'customer-commercial' })
</script>
<template>
  <SettingsLayout width="detail">
    <SharedPageHeader :title="data?.number ?? t('subscription.invoices.title')" :description="data ? `${data.period_start} → ${data.period_end}` : undefined" back-to="/subscription/invoices" :back-label="t('subscription.invoices.back')" />
    <p v-if="!allowed" class="text-muted">{{ t('subscription.forbidden') }}</p>
    <SharedPageState v-else :loading="pending" :error="error" @retry="refresh"><SubscriptionInvoiceLines v-if="data" :invoice="data" /></SharedPageState>
  </SettingsLayout>
</template>
