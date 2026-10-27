<script setup lang="ts">
import { invoiceStatusBadge } from '@webvue/commercial-ui/app/utils/commercialBadges'
import { adjustmentStatusBadge, paymentAttemptBadge } from '@/utils/vendorBadges'
import { formatCommercialMoney } from '@webvue/commercial-ui/app/utils/commercial'
import { invoicesReturnTo, isNotAvailable, refundErrorKey, validRefundDraft, vendorInvoiceLineViews } from '@/utils/vendorSubscriptions'
import { useVendorSubscriptions } from '@/composables/useVendorSubscriptions'
import { formatWebVueDate, formatWebVueDateTime } from '@webvue/ui/app/composables/calendarDate'
definePageMeta({ capability: 'vendor.billing.manage' })
const { t, locale } = useI18n(); const route = useRoute(); const api = useVendorSubscriptions()
const { can } = useVendorContext()
const hydrated = useHydrated()
const canBilling = computed(() => can('vendor.billing.manage'))
const id = computed(() => String(route.params.id))
const backTo = computed(() => invoicesReturnTo(route.query.returnTo))
const { data, error, pending, refresh } = await useAsyncData(() => `vendor:invoice:${id.value}`, () => api.invoice(id.value))
const orderId = computed(() => data.value?.order_id)
const { data: attempts, error: attemptsError, pending: attemptsPending, refresh: refreshAttempts } = await useAsyncData(
  () => `vendor:invoice-attempts:${id.value}:${orderId.value ?? 'none'}:${canBilling.value}`,
  () => orderId.value && canBilling.value ? api.paymentAttempts(orderId.value) : Promise.resolve(null),
)
const attemptTime = (value: string) => formatWebVueDateTime(value, locale.value)
const unavailable = computed(() => isNotAvailable(error.value) && !data.value)
const money = (m: NonNullable<typeof data.value>['total']) => formatCommercialMoney(m, locale.value)
const date = (v: string | null) => (v ? formatWebVueDate(v, locale.value) : null)
const canRefund = computed(() => canBilling.value && !unavailable.value)
const refundNoteId = ref<string | null>(null)
const refundReference = ref('')
const refundReason = ref('')
const refundBusy = ref(false)
const refundFailure = ref<string | undefined>()
const refundValid = computed(() => validRefundDraft({ reference: refundReference.value, reason: refundReason.value }))
function openRefund(noteId: string) { refundNoteId.value = noteId; refundReference.value = ''; refundReason.value = ''; refundFailure.value = undefined }
function closeRefund() { refundNoteId.value = null; refundReference.value = ''; refundReason.value = ''; refundFailure.value = undefined }
async function recordRefund() {
  if (!hydrated.value || refundBusy.value || !canRefund.value || !refundNoteId.value || !refundValid.value) return
  refundBusy.value = true; refundFailure.value = undefined
  try {
    await api.refundCreditNote(refundNoteId.value, { external_reference: refundReference.value, reason: refundReason.value })
    closeRefund()
  } catch (cause) {
    refundFailure.value = t(refundErrorKey(cause))
  } finally {
    // The note may already have been closed by someone else: always show the server's current state.
    try { await refresh() } finally { refundBusy.value = false }
  }
}
const badge = computed(() => (data.value ? invoiceStatusBadge(data.value.status, 'vendor.invoices.status') : null))
</script>
<template>
<SharedRecordPage :title="data ? (data.number ?? t('vendor.invoices.draftNumber')) : t('vendor.invoices.details')" :back-to="backTo" :loading="pending" :error="unavailable ? undefined : error" @retry="refresh">
  <UAlert v-if="unavailable" color="neutral" variant="subtle" icon="i-lucide-clock" :title="t('vendor.invoices.notAvailable')" :description="t('vendor.invoices.notAvailableHint')" />

  <template v-if="data && !unavailable" #summary>
    <div class="space-y-4" data-testid="invoice-header">
      <div class="flex flex-wrap items-center gap-3">
        <SharedStatusBadge v-if="badge" :tone="badge.tone" :label="t(badge.labelKey)" />
        <span class="text-sm text-muted">{{ t(`vendor.invoices.kind.${data.kind}`) }}</span>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <SharedMetricTile :label="t('vendor.invoices.total')" :value="money(data.total)" icon="i-lucide-receipt" value-dir="ltr" />
        <SharedMetricTile :label="t('vendor.invoices.dueAt')" :value="date(data.due_at)" icon="i-lucide-calendar-clock" />
      </div>
    </div>
  </template>

  <div v-if="data && !unavailable" class="space-y-6">
    <UAlert color="neutral" variant="subtle" icon="i-lucide-info" :title="t('vendor.invoices.notOfficial')" :description="t('vendor.invoices.notOfficialHint')" data-testid="not-official" />
    <SharedRecordSection :title="t('vendor.invoices.lines')"><SharedInvoiceLines :lines="vendorInvoiceLineViews(data.lines, t, locale)" :totals="[{label:t('vendor.invoices.subtotal'),value:money(data.subtotal)},{label:t('vendor.invoices.vat'),value:money(data.tax)},{label:t('vendor.invoices.total'),value:money(data.total)}]" /><p class="text-xs text-muted">{{ t('vendor.invoices.vatNote') }}</p></SharedRecordSection>

    <SharedRecordSection v-if="canBilling" :title="t('vendor.invoices.attempts')">
      <SharedPageState :loading="attemptsPending" :error="attemptsError" @retry="refreshAttempts">
        <SharedEmptyState v-if="!attempts?.items.length" :title="t('vendor.invoices.attemptsNone')" icon="i-lucide-credit-card" />
        <ul v-else class="divide-y divide-default">
          <li v-for="attempt in attempts.items" :key="attempt.id" class="flex flex-wrap items-center justify-between gap-3 py-3" data-testid="payment-attempt">
            <SharedStatusBadge :tone="paymentAttemptBadge(attempt.status).tone" :label="t(paymentAttemptBadge(attempt.status).labelKey)" />
            <span class="tabular-nums">{{ money(attempt.amount) }}</span>
            <time :datetime="attempt.created_at" class="text-sm text-muted">{{ attemptTime(attempt.created_at) }}</time>
          </li>
        </ul>
      </SharedPageState>
    </SharedRecordSection>
    <SharedRecordSection :title="t('vendor.invoices.adjustments')">
      <p v-if="!data.adjustments.length" class="text-sm text-muted">{{ t('vendor.invoices.adjustmentsNone') }}</p>
      <ul v-else class="divide-y divide-default">
        <li v-for="note in data.adjustments" :key="note.id" class="space-y-3 py-3" data-testid="adjustment">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex flex-wrap items-center gap-3">
              <SharedStatusBadge :tone="adjustmentStatusBadge(note.status).tone" :label="t(adjustmentStatusBadge(note.status).labelKey)" />
              <span class="text-sm text-muted">{{ t(`vendor.invoices.adjustmentKind.${note.kind}`) }}</span>
            </div>
            <span class="tabular-nums">{{ money(note.amount) }}</span>
          </div>
          <p class="text-sm">{{ note.reason }}</p>
          <dl v-if="note.status === 'refunded'" class="grid gap-2 text-sm sm:grid-cols-3" data-testid="refund-record">
            <div><dt class="text-muted">{{ t('vendor.invoices.refund.reference') }}</dt><dd><bdi dir="ltr">{{ note.refund_reference }}</bdi></dd></div>
            <div><dt class="text-muted">{{ t('vendor.invoices.refund.at') }}</dt><dd>{{ note.refunded_at ? attemptTime(note.refunded_at) : '' }}</dd></div>
            <div><dt class="text-muted">{{ t('vendor.invoices.refund.by') }}</dt><dd><bdi dir="ltr">{{ note.refunded_by }}</bdi></dd></div>
          </dl>
          <template v-if="canRefund && note.kind === 'credit_note' && note.status === 'pending'">
            <SharedInlineConfirm v-if="refundNoteId === note.id" :title="t('vendor.invoices.refund.title')" :description="t('vendor.invoices.refund.description')" :confirm-label="t('vendor.invoices.refund.confirm')" :pending="refundBusy" :disabled="!hydrated || refundBusy || !refundValid" @confirm="recordRefund" @cancel="closeRefund">
              <div class="mt-3 space-y-4">
                <UFormField :label="t('vendor.invoices.refund.reference')" :help="t('vendor.invoices.refund.referenceHint')" required><UInput v-model="refundReference" :maxlength="200" dir="ltr" :disabled="!hydrated || refundBusy" class="w-full" /></UFormField>
                <UFormField :label="t('vendor.invoices.refund.reason')" required><UTextarea v-model="refundReason" :maxlength="1000" :disabled="!hydrated || refundBusy" class="w-full" /></UFormField>
              </div>
            </SharedInlineConfirm>
            <UButton v-else color="neutral" variant="outline" size="sm" :disabled="!hydrated || refundBusy" @click="openRefund(note.id)">{{ t('vendor.invoices.refund.action') }}</UButton>
          </template>
        </li>
      </ul>
      <UAlert v-if="refundFailure" class="mt-3" color="error" variant="subtle" :title="refundFailure" data-testid="refund-failure" />
      <p class="mt-1 text-xs text-muted">{{ t('vendor.invoices.immutable') }}</p>
    </SharedRecordSection>
    <details class="text-sm"><summary class="cursor-pointer text-muted">{{ t('vendor.customers.technical') }}</summary>
      <dl class="mt-3 space-y-2"><div><dt>{{ t('vendor.invoices.techId') }}</dt><dd dir="ltr">{{ data.id }}</dd></div><div v-if="data.order_id"><dt>{{ t('vendor.invoices.techOrder') }}</dt><dd dir="ltr">{{ data.order_id }}</dd></div></dl>
    </details>
  </div>

  <template v-if="data && !unavailable" #aside>
    <SharedPropertiesPanel>
      <SharedPropertyRow :label="t('vendor.invoices.customer')"><NuxtLink :to="{ path: `/customers/${encodeURIComponent(data.customer_id)}` }" class="hover:underline">{{ data.customer_name }}</NuxtLink></SharedPropertyRow>
      <SharedPropertyRow :label="t('vendor.invoices.period')"><bdi dir="ltr">{{ data.period_start }} → {{ data.period_end }}</bdi></SharedPropertyRow>
      <SharedPropertyRow :label="t('vendor.invoices.issuedAt')" :value="date(data.issued_at)" />
      <SharedPropertyRow :label="t('vendor.invoices.paidAt')" :value="date(data.paid_at)" />
    </SharedPropertiesPanel>
  </template>
</SharedRecordPage>
</template>
