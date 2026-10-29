<script setup lang="ts">
import { subscriptionDisplayState } from '@webvue/commercial-contracts'
import { orderOutcome, safePaymentRedirect, subscriptionStateBadge } from '@/utils/subscription'
import { useCustomerCapabilities, useSubscriptionApi } from '@/composables/useSubscription'
const { t } = useI18n(); const route = useRoute(); const api = useSubscriptionApi(); const { can } = useCustomerCapabilities(); const hydrated = useHydrated()
const allowed = computed(() => can('subscription.read'))
const orderId = computed(() => String(route.query.order ?? ''))
// Read-only: this page only calls GET subscription. A refresh can never create an order or payment attempt.
const { data: loaded, error, pending, refresh } = await useAsyncData(() => `subscription:status:${orderId.value}`, async () => {
  const sub = await api.subscription()
  // A 404 means the order is not this customer's; any other read failure is reported, never shown as settled.
  let read: Awaited<ReturnType<typeof api.order>> | null = null
  let readFailed = false
  if (orderId.value) {
    try { read = await api.order(orderId.value) } catch (e: any) { readFailed = (e?.statusCode ?? e?.status) !== 404 }
  }
  return { sub, read, readFailed }
}, { immediate: allowed.value, watch: [orderId] })
const data = computed(() => loaded.value?.sub ?? null)
// Without ?order follow the open order. With ?order prefer the read (any state); else the open order if it is that one.
const order = computed(() => {
  const open = data.value?.pending_order ?? null
  if (!orderId.value) return open
  return loaded.value?.read ?? (open && open.id === orderId.value ? open : null)
})
const outcome = computed(() => (order.value ? orderOutcome(order.value) : null))
const display = computed(() => (data.value ? subscriptionDisplayState(data.value) : null))
// Only when the read failed and the order is no longer open: its result is unknown, which is not a failure.
const readFailed = computed(() => !order.value && Boolean(loaded.value?.readFailed))
const settled = computed(() => !!data.value && !order.value && Boolean(orderId.value) && !readFailed.value)
// The control plane opens a payment attempt only while the order still awaits payment; a declined one is final.
const canRetry = computed(() => outcome.value === 'awaiting_payment' && can('subscription.manage'))
// Poll while activation or payment confirmation is in flight, one request at a time, for at most POLL_LIMIT_MS.
const POLL_INTERVAL_MS = 5000
const POLL_LIMIT_MS = 5 * 60 * 1000
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  const stopAt = Date.now() + POLL_LIMIT_MS
  timer = setInterval(() => {
    if (Date.now() > stopAt) return clearInterval(timer)
    if (!pending.value && (outcome.value === 'processing' || outcome.value === 'awaiting_payment')) void refresh()
  }, POLL_INTERVAL_MS)
})
onBeforeUnmount(() => clearInterval(timer))
const OUTCOME_COLOR = { applied: 'success', processing: 'info', awaiting_payment: 'warning', cancelled: 'neutral', payment_failed: 'error', activation_failed: 'error', refund: 'error' } as const
const payBusy = ref(false); const payError = ref<string | undefined>()
async function continuePayment() {
  if (!order.value || payBusy.value) return
  payBusy.value = true; payError.value = undefined
  try {
    const attempt = await api.payment(order.value.id, `status:${order.value.id}`)
    const url = safePaymentRedirect(attempt.redirect_url, window.location.origin)
    if (url) window.location.assign(url)
    else payError.value = t('subscription.status.paymentFailed')
  } catch { payError.value = t('subscription.status.paymentFailed') } finally { payBusy.value = false }
}
// Owner decision 2026-10-29: a customer cancels only its own unpaid first order.
const canCancel = computed(() => outcome.value === 'awaiting_payment' && order.value?.kind === 'new' && can('subscription.manage'))
const cancelOpen = ref(false); const cancelReason = ref(''); const cancelBusy = ref(false); const cancelError = ref<string | undefined>()
const validReason = computed(() => cancelReason.value.trim().length >= 3 && cancelReason.value.trim().length <= 1000)
async function cancelFirstOrder() {
  if (!order.value || cancelBusy.value || !validReason.value) return
  cancelBusy.value = true; cancelError.value = undefined
  try { await api.cancelOrder(order.value.id, cancelReason.value); cancelOpen.value = false; cancelReason.value = ''; await refresh() }
  catch { cancelError.value = t('subscription.status.cancelFailed') } finally { cancelBusy.value = false }
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
          <UAlert
            v-if="order && outcome" data-testid="order-outcome" :data-outcome="outcome" variant="subtle"
            :color="OUTCOME_COLOR[outcome]"
            :title="t(`subscription.status.outcomes.${outcome}.title`)" :description="t(`subscription.status.outcomes.${outcome}.description`)"
          />
          <SharedPropertiesPanel v-if="order && outcome !== 'applied'" data-testid="order-status">
            <SharedPropertyRow :label="t('subscription.status.payment')" :value="t(`subscription.status.payments.${order.payment_state}`)" />
            <SharedPropertyRow :label="t('subscription.status.fulfillment')" :value="t(`subscription.status.fulfillments.${order.fulfillment_state}`)" />
          </SharedPropertiesPanel>
          <UAlert v-else-if="readFailed" color="error" variant="subtle" role="alert" data-testid="order-read-error" :title="t('subscription.status.readError')" />
          <p v-else-if="settled" class="text-sm text-muted" role="status" data-testid="order-settled">{{ t('subscription.status.settled') }}</p>
          <p v-else class="text-sm text-muted" role="status" data-testid="order-empty">{{ t('subscription.status.empty') }}</p>
          <UAlert v-if="payError" color="error" variant="subtle" role="alert" :title="payError" />
          <SharedInlineConfirm v-if="canCancel && cancelOpen" :title="t('subscription.status.cancel.title')" :description="t('subscription.status.cancel.description')" :confirm-label="t('subscription.status.cancel.action')" :pending="cancelBusy" :disabled="!hydrated || cancelBusy || !validReason" @confirm="cancelFirstOrder" @cancel="cancelOpen = false">
            <UFormField :label="t('subscription.status.cancel.reason')" required class="mt-3"><UTextarea v-model="cancelReason" :maxlength="1000" :disabled="!hydrated || cancelBusy" class="w-full" /></UFormField>
          </SharedInlineConfirm>
          <UAlert v-if="cancelError" color="error" variant="subtle" role="alert" :title="cancelError" />
          <div class="flex flex-wrap gap-2">
            <UButton v-if="canCancel && !cancelOpen" color="error" variant="outline" :disabled="!hydrated" @click="cancelOpen = true">{{ t('subscription.status.cancel.action') }}</UButton>
            <UButton v-if="canRetry" :disabled="!hydrated || payBusy" :loading="payBusy" @click="continuePayment">{{ t('subscription.status.retryPayment') }}</UButton>
            <UButton v-if="!order || outcome === 'applied' || outcome === 'cancelled' || outcome === 'payment_failed'" to="/subscription" color="neutral" variant="outline">{{ t('subscription.status.viewSubscription') }}</UButton>
            <UButton color="neutral" variant="outline" :disabled="!hydrated" @click="refresh()">{{ t('subscription.status.refresh') }}</UButton>
          </div>
        </div>
      </SharedRecordSection>
    </SharedPageState>
  </SharedSettingsPage>
</template>
