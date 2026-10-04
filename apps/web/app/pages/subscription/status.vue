<script setup lang="ts">
import { subscriptionDisplayState } from '@nasq/commercial-contracts'
import SettingsLayout from '@/components/settings/SettingsLayout.vue'
import { safePaymentRedirect } from '@/utils/subscription'
import { useCustomerCapabilities, useSubscriptionApi } from '@/composables/useSubscription'
const { t } = useI18n(); const route = useRoute(); const api = useSubscriptionApi(); const { can } = useCustomerCapabilities(); const hydrated = useHydrated()
const allowed = computed(() => can('subscription.read'))
const orderId = computed(() => String(route.query.order ?? ''))
// Read-only: this page only calls GET subscription. A refresh can never create an order or payment attempt.
const { data, error, pending, refresh } = await useAsyncData(() => `subscription:status:${orderId.value}`, () => api.subscription(), { immediate: allowed.value, watch: [orderId] })
const order = computed(() => (data.value?.pending_order?.id === orderId.value ? data.value.pending_order : null))
const display = computed(() => (data.value ? subscriptionDisplayState(data.value) : null))
const settled = computed(() => !!data.value && !order.value && Boolean(orderId.value))
// Poll while activation is in flight.
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { timer = setInterval(() => { if (order.value && order.value.fulfillment_state !== 'failed' && order.value.fulfillment_state !== 'needs_intervention') void refresh() }, 5000) })
onBeforeUnmount(() => clearInterval(timer))
const payBusy = ref(false)
async function continuePayment() {
  if (!order.value || payBusy.value) return
  payBusy.value = true
  try {
    const attempt = await api.payment(order.value.id, `status:${order.value.id}`)
    const url = safePaymentRedirect(attempt.redirect_url, window.location.origin)
    if (url) window.location.assign(url)
  } finally { payBusy.value = false }
}
definePageMeta({ middleware: 'customer-commercial' })
</script>
<template>
  <SettingsLayout width="form">
    <SharedPageHeader :title="t('subscription.status.title')" :description="t('subscription.status.description')" back-to="/subscription" />
    <p v-if="!allowed" class="text-muted">{{ t('subscription.forbidden') }}</p>
    <SharedPageState v-else :loading="pending" :error="error" @retry="refresh">
      <div class="space-y-4">
        <SubscriptionStateBadge v-if="display" :state="display" />
        <dl v-if="order" class="space-y-2 rounded-lg p-3 ring ring-default" data-testid="order-status">
          <div class="flex justify-between gap-3"><dt class="text-muted">{{ t('subscription.status.payment') }}</dt><dd>{{ t(`subscription.status.payments.${order.payment_state}`) }}</dd></div>
          <div class="flex justify-between gap-3"><dt class="text-muted">{{ t('subscription.status.fulfillment') }}</dt><dd>{{ t(`subscription.status.fulfillments.${order.fulfillment_state}`) }}</dd></div>
        </dl>
        <p v-else-if="settled" class="text-sm text-muted" role="status">{{ t('subscription.status.missing') }}</p>
        <div class="flex gap-2">
          <UButton color="neutral" variant="outline" :disabled="!hydrated" @click="refresh()">{{ t('subscription.status.refresh') }}</UButton>
          <UButton v-if="order && order.payment_state === 'awaiting_payment' && can('subscription.manage')" :disabled="!hydrated || payBusy" :loading="payBusy" @click="continuePayment">{{ t('subscription.status.retryPayment') }}</UButton>
        </div>
      </div>
    </SharedPageState>
  </SettingsLayout>
</template>
