<script setup lang="ts">
import { subscriptionStateBadge } from '@/utils/subscription'
import { subscriptionDisplayState } from '@webvue/commercial-contracts'
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
  <SharedSettingsPage width="form">
    <SharedPageHeader :title="t('subscription.status.title')" back-to="/subscription" />
    <SharedForbiddenState v-if="!allowed" />
    <SharedPageState v-else :loading="pending" :error="error" @retry="refresh">
      <SharedRecordSection variant="panel" :title="t('subscription.status.order')">
        <template #actions><SharedStatusBadge v-if="display" data-slot="subscription-state" :data-state="display" :tone="subscriptionStateBadge(display).tone" :label="t(subscriptionStateBadge(display).labelKey)" /></template>
        <div class="space-y-4">
          <SharedPropertiesPanel v-if="order" data-testid="order-status">
            <SharedPropertyRow :label="t('subscription.status.payment')" :value="t(`subscription.status.payments.${order.payment_state}`)" />
            <SharedPropertyRow :label="t('subscription.status.fulfillment')" :value="t(`subscription.status.fulfillments.${order.fulfillment_state}`)" />
          </SharedPropertiesPanel>
          <p v-else-if="settled" class="text-sm text-muted" role="status">{{ t('subscription.status.missing') }}</p>
          <div class="flex flex-wrap gap-2">
            <UButton color="neutral" variant="outline" :disabled="!hydrated" @click="refresh()">{{ t('subscription.status.refresh') }}</UButton>
            <UButton v-if="order && order.payment_state === 'awaiting_payment' && can('subscription.manage')" :disabled="!hydrated || payBusy" :loading="payBusy" @click="continuePayment">{{ t('subscription.status.retryPayment') }}</UButton>
          </div>
        </div>
      </SharedRecordSection>
    </SharedPageState>
  </SharedSettingsPage>
</template>
