<script setup lang="ts">
import { CARD_CONSENT_KEY, type CardFormSession, clearPaymentStarted, markPaymentStarted, payRefusal, paymentWasStarted } from '@/utils/cardPayment'
import { formatSubscriptionMoney, orderOutcome } from '@/utils/subscription'
import { useCustomerCapabilities, useSubscriptionApi } from '@/composables/useSubscription'
const { t, locale } = useI18n(); const route = useRoute(); const api = useSubscriptionApi(); const { can } = useCustomerCapabilities(); const hydrated = useHydrated()
const allowed = computed(() => can('subscription.read'))
const canPay = computed(() => can('subscription.manage'))
const orderId = computed(() => String(route.params.order ?? ''))
const statusTo = computed(() => ({ path: '/subscription/status', query: { order: orderId.value } }))
// Read-only: opening this page never creates an order, an attempt or a form session. Only "Continue" does.
const { data: loaded, error, pending, refresh } = await useAsyncData(() => `subscription:pay:${orderId.value}`, async () => {
  const order = await api.order(orderId.value).catch((cause: any) => { if ((cause?.statusCode ?? cause?.status) === 404) return null; throw cause })
  const invoices = order && can('billing.read') ? await api.invoices().then(list => list.items, () => []) : []
  return { order, invoice: invoices.find(item => item.order_id === orderId.value && item.status === 'issued') ?? null }
}, { immediate: allowed.value, watch: [orderId] })
const order = computed(() => loaded.value?.order ?? null)
const invoice = computed(() => loaded.value?.invoice ?? null)
const outcome = computed(() => (order.value ? orderOutcome(order.value) : null))
const payable = computed(() => outcome.value === 'awaiting_payment')
// A paid, activating or refunded order has nothing to pay: its status page says what happened.
const settledElsewhere = () => Boolean(outcome.value && outcome.value !== 'awaiting_payment' && outcome.value !== 'cancelled')
if (settledElsewhere()) await navigateTo(statusTo.value, { replace: true })
watch(outcome, async () => { if (settledElsewhere()) await navigateTo(statusTo.value, { replace: true }) })

type Phase = 'choose' | 'starting' | 'form' | 'checking' | 'unavailable' | 'expired'
const phase = ref<Phase>('choose')
const saveCard = ref(false)
const autoRenewDenied = ref(false)
const session = ref<CardFormSession | null>(null)
const sessionSavesCard = ref(false)
const failed = ref(false); const forbidden = ref(false)
const lastAttemptOpened = ref(false)
function startedBefore() { return import.meta.client && paymentWasStarted(window.sessionStorage, orderId.value) }
onMounted(() => { lastAttemptOpened.value = startedBefore() })

async function start(allowSaving = saveCard.value) {
  if (!hydrated.value || !canPay.value || !payable.value || phase.value === 'starting') return
  phase.value = 'starting'; failed.value = false; forbidden.value = false
  try {
    session.value = await api.startCardPayment(orderId.value, allowSaving)
    sessionSavesCard.value = allowSaving
    markPaymentStarted(window.sessionStorage, orderId.value)
    phase.value = 'form'
  } catch (cause) {
    const refusal = payRefusal(cause)
    if (refusal === 'auto_renew_not_allowed') { autoRenewDenied.value = true; saveCard.value = false; return await start(false) }
    if (refusal === 'in_progress') { phase.value = 'checking'; beginChecking(); return }
    if (refusal === 'not_awaiting') { await refresh(); phase.value = 'choose'; return }
    if (refusal === 'form_unavailable') { phase.value = 'unavailable'; return }
    forbidden.value = refusal === 'forbidden'; failed.value = refusal !== 'forbidden'; phase.value = 'choose'
  }
}

// A payment may be in flight: look at the order calmly, never offer a second form, and leave once it is settled.
const CHECK_INTERVAL_MS = 5000
const CHECK_LIMIT_MS = 3 * 60 * 1000
const stillChecking = ref(false)
let checkTimer: ReturnType<typeof setInterval> | undefined
function stopChecking() { clearInterval(checkTimer); checkTimer = undefined }
function beginChecking() {
  stopChecking(); stillChecking.value = false
  const stopAt = Date.now() + CHECK_LIMIT_MS
  checkTimer = setInterval(async () => {
    if (Date.now() > stopAt) { stopChecking(); stillChecking.value = true; return }
    try { await refresh() } catch { /* the next look tries again */ }
  }, CHECK_INTERVAL_MS)
}
onBeforeUnmount(stopChecking)
function chooseAgain() { stopChecking(); session.value = null; phase.value = 'choose'; failed.value = false; forbidden.value = false }
watch(outcome, value => { if (value && value !== 'awaiting_payment') { stopChecking(); clearPaymentStarted(window.sessionStorage, orderId.value) } })
definePageMeta({ middleware: 'customer-commercial' })
</script>
<template>
  <SharedSettingsPage>
    <SharedPageHeader :title="t('subscription.pay.title')" back-to="/subscription/status" />
    <SharedForbiddenState v-if="!allowed" />
    <SharedPageState v-else :loading="pending && !loaded" :error="error" @retry="refresh">
      <div v-if="loaded && !order" class="space-y-3" data-testid="pay-not-found">
        <UAlert color="warning" variant="subtle" role="alert" :title="t('subscription.pay.notFound.title')" :description="t('subscription.pay.notFound.description')" />
        <UButton to="/subscription" color="neutral" variant="outline">{{ t('subscription.status.viewSubscription') }}</UButton>
      </div>
      <div v-else-if="order && outcome === 'cancelled'" class="space-y-3" data-testid="pay-cancelled">
        <UAlert color="neutral" variant="subtle" :title="t('subscription.status.outcomes.cancelled.title')" :description="t('subscription.status.outcomes.cancelled.description')" />
        <UButton to="/subscription" color="neutral" variant="outline">{{ t('subscription.status.viewSubscription') }}</UButton>
      </div>
      <div v-else-if="order && payable" class="grid gap-(--liwan-gap-card)">
        <SharedRecordSection variant="panel" :title="t('subscription.pay.order')">
          <SharedPropertiesPanel data-testid="pay-order">
            <SharedPropertyRow :label="t('subscription.pay.what')" :value="t(`subscription.pay.kinds.${order.kind}`)" />
            <SharedPropertyRow v-if="invoice?.number" :label="t('subscription.pay.invoice')"><NuxtLink :to="`/subscription/invoices/${encodeURIComponent(invoice.id)}`" class="hover:underline"><bdi dir="ltr">{{ invoice.number }}</bdi></NuxtLink></SharedPropertyRow>
            <SharedPropertyRow :label="t('subscription.pay.amount')"><bdi dir="ltr" class="font-semibold tabular-nums" data-testid="pay-amount">{{ formatSubscriptionMoney(invoice?.total ?? order.due_now, locale) }}</bdi></SharedPropertyRow>
          </SharedPropertiesPanel>
        </SharedRecordSection>

        <UAlert v-if="!canPay" color="warning" variant="subtle" role="status" data-testid="pay-no-permission" :title="t('subscription.pay.noPermission.title')" :description="t('subscription.pay.noPermission.description')" />

        <template v-else>
          <UAlert v-if="lastAttemptOpened && phase === 'choose'" color="warning" variant="subtle" role="status" data-testid="pay-not-completed" :title="t('subscription.status.notCompleted.title')" :description="t('subscription.status.notCompleted.description')" />
          <UAlert v-if="forbidden" color="error" variant="subtle" role="alert" :title="t('subscription.pay.forbidden')" />
          <UAlert v-if="failed" color="error" variant="subtle" role="alert" data-testid="pay-failed" :title="t('subscription.pay.failed')" />
          <UAlert v-if="autoRenewDenied && phase !== 'unavailable'" color="info" variant="subtle" role="status" data-testid="pay-auto-renew-denied" :title="t('subscription.pay.autoRenewNotAllowed')" />

          <SharedRecordSection variant="panel" :title="t('subscription.pay.card.title')" data-testid="pay-by-card">
            <div v-if="phase === 'checking'" class="space-y-3" role="status" data-testid="pay-checking">
              <UAlert color="info" variant="subtle" icon="i-lucide-loader-circle" :title="t('subscription.pay.checking.title')" :description="t(stillChecking ? 'subscription.pay.checking.still' : 'subscription.pay.checking.description')" />
              <UButton v-if="stillChecking" color="neutral" variant="outline" :disabled="!hydrated" @click="beginChecking(); refresh()">{{ t('subscription.status.refresh') }}</UButton>
            </div>
            <div v-else-if="phase === 'unavailable'" class="space-y-3" data-testid="pay-unavailable">
              <UAlert color="warning" variant="subtle" role="alert" :title="t('subscription.pay.unavailable.title')" :description="t('subscription.pay.unavailable.description')" />
              <UButton color="neutral" variant="outline" :disabled="!hydrated" @click="chooseAgain">{{ t('subscription.pay.tryAgain') }}</UButton>
            </div>
            <div v-else-if="phase === 'expired'" class="space-y-3" data-testid="pay-expired">
              <UAlert color="warning" variant="subtle" role="alert" :title="t('subscription.pay.expired.title')" :description="t('subscription.pay.expired.description')" />
              <UButton :disabled="!hydrated" @click="chooseAgain">{{ t('subscription.pay.expired.again') }}</UButton>
            </div>
            <div v-else-if="phase === 'form' && session" class="space-y-3" data-testid="pay-form">
              <p class="text-sm text-muted" data-testid="pay-choice-fixed">{{ t(sessionSavesCard ? 'subscription.pay.card.willSave' : 'subscription.pay.card.willNotSave') }}</p>
              <SubscriptionPaymentForm :key="session.attempt_id" :session="session" :save-card="sessionSavesCard" @expired="phase = 'expired'" />
              <UButton color="neutral" variant="outline" size="sm" :disabled="!hydrated" data-testid="pay-change-choice" @click="chooseAgain">{{ t('subscription.pay.card.change') }}</UButton>
            </div>
            <div v-else class="space-y-4" data-testid="pay-choose">
              <p class="text-sm text-muted">{{ t('subscription.pay.card.hint') }}</p>
              <UCheckbox v-if="!autoRenewDenied" v-model="saveCard" data-testid="pay-save-card" :label="t(CARD_CONSENT_KEY)" :disabled="!hydrated || phase === 'starting'" />
              <UButton :disabled="!hydrated || phase === 'starting'" :loading="phase === 'starting'" data-testid="pay-continue" @click="start()">{{ t('subscription.pay.card.continue') }}</UButton>
            </div>
          </SharedRecordSection>

          <SharedRecordSection variant="panel" :title="t('subscription.pay.transfer.title')" data-testid="pay-by-transfer">
            <p class="text-sm text-muted">{{ t('subscription.pay.transfer.hint') }}</p>
            <UButton v-if="invoice" class="mt-3" color="neutral" variant="outline" :to="`/subscription/invoices/${encodeURIComponent(invoice.id)}`" data-testid="pay-transfer-link">{{ t('subscription.pay.transfer.action') }}</UButton>
            <p v-else class="mt-3 text-sm text-muted" data-testid="pay-transfer-none">{{ t('subscription.pay.transfer.none') }}</p>
          </SharedRecordSection>
        </template>
      </div>
    </SharedPageState>
  </SharedSettingsPage>
</template>
