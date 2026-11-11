<script setup lang="ts">
import { invoiceStatusBadge } from '@liwan/commercial-ui/app/utils/commercialBadges'
import { adjustmentStatusBadge, paymentAttemptBadge } from '@/utils/vendorBadges'
import { formatCommercialMoney } from '@liwan/commercial-ui/app/utils/commercial'
import { commercialErrorKey } from '@/utils/vendorCommercial'
import { invoiceHasAiTopup, invoicesReturnTo, isNotAvailable, parseTransferAmount, parseUnitsUsed, refundErrorKey, refundRequestBlock, transferFormDefaults, validRefundDraft, validRefundReason, vendorInvoiceLineViews } from '@/utils/vendorSubscriptions'
import { useVendorSubscriptions } from '@/composables/useVendorSubscriptions'
import { formatLiwanDate, formatLiwanDateTime } from '@liwan/ui/app/composables/calendarDate'
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
const attemptTime = (value: string) => formatLiwanDateTime(value)
const unavailable = computed(() => isNotAvailable(error.value) && !data.value)
const money = (m: NonNullable<typeof data.value>['total']) => formatCommercialMoney(m, locale.value)
/** Subtotal, the tax line only when the invoice charged one, then the total. Liwan's own invoices carry no tax, so their subtotal is the whole amount and is never called "before tax". */
const totals = computed(() => {
  const invoice = data.value
  if (!invoice) return []
  return [
    { label: t(invoice.tax_label === null ? 'vendor.invoices.subtotalNoTax' : 'vendor.invoices.subtotal'), value: money(invoice.subtotal) },
    ...(invoice.tax_label === null ? [] : [{ label: t('vendor.invoices.taxLine', { label: invoice.tax_label }), value: money(invoice.tax) }]),
    { label: t('vendor.invoices.total'), value: money(invoice.total) },
  ]
})
const date = (v: string | null) => (v ? formatLiwanDate(v) : null)
const refundUntil = computed(() => (data.value?.refund?.until ? formatLiwanDate(data.value.refund.until) : ''))
/**
 * Recording a refund needs only the billing grant. The window is judged once, by the server, when a vendor note is
 * created; a pending note is recordable afterwards whatever the date, and a system note (duplicate charge, payment after
 * cancellation, failed fulfilment) is always recordable.
 */
const canRecordRefund = computed(() => canBilling.value && !unavailable.value)
/** The stated eligibility of the customer's payment: first payment or not, and the deadline or the closed window. */
// Only a paid invoice can be refunded, so the eligibility alert is about a paid one; on an unpaid invoice it would
// claim "this is not the customer's first payment" about a payment that does not exist yet.
const refundEligibility = computed(() => {
  const refund = data.value?.refund
  if (!refund || data.value?.status !== 'paid') return null
  const label = refund.refundable ? t('vendor.invoices.refund.eligibilityRefundable', { date: refundUntil.value })
    : refund.first_payment ? t('vendor.invoices.refund.windowClosed', { days: refund.window_days })
      : t('vendor.invoices.refund.notFirstPayment')
  return { firstPayment: refund.first_payment, refundable: refund.refundable, label }
})
// Asking for the refund of a paid invoice: the server decides whether it is allowed; the page states why it is not.
const requestOpen = ref(false)
const requestReason = ref('')
const requestUnitsUsed = ref('')
const requestBusy = ref(false)
const requestFailure = ref<string | undefined>()
const requestBlock = computed(() => (data.value ? refundRequestBlock(data.value) : null))
const requestBlockText = computed(() => {
  if (!requestBlock.value) return ''
  return requestBlock.value === 'windowClosed' ? t('vendor.invoices.refund.windowClosed', { days: data.value?.refund.window_days }) : t(`vendor.invoices.refund.${requestBlock.value}`)
})
const canRequestRefund = computed(() => canBilling.value && !unavailable.value && data.value?.status === 'paid' && requestBlock.value === null)
const requestNeedsUnits = computed(() => (data.value ? invoiceHasAiTopup(data.value) : false))
const requestUnits = computed(() => parseUnitsUsed(requestUnitsUsed.value))
const requestUnitsError = computed(() => (requestNeedsUnits.value && requestUnitsUsed.value.trim() && requestUnits.value === null ? t('vendor.invoices.refund.request.unitsUsedInvalid') : undefined))
const requestValid = computed(() => validRefundReason(requestReason.value) && (!requestNeedsUnits.value || requestUnits.value !== null))
function openRequest() { requestOpen.value = true; requestReason.value = ''; requestUnitsUsed.value = ''; requestFailure.value = undefined }
function closeRequest() { requestOpen.value = false; requestReason.value = ''; requestUnitsUsed.value = ''; requestFailure.value = undefined }
async function requestRefund() {
  if (!hydrated.value || requestBusy.value || !canRequestRefund.value || !requestValid.value || !data.value) return
  requestBusy.value = true; requestFailure.value = undefined
  try {
    await api.requestRefund(data.value.id, { reason: requestReason.value, ...(requestNeedsUnits.value && requestUnits.value !== null ? { units_used: requestUnits.value } : {}) })
    closeRequest()
  } catch (cause) {
    requestFailure.value = t(refundErrorKey(cause))
  } finally {
    // The invoice carries the adjustments; the attempts are read separately. Show the server's state after a refusal too.
    try { await Promise.all([refresh(), refreshAttempts()]) } finally { requestBusy.value = false }
  }
}
const refundNoteId = ref<string | null>(null)
const refundReference = ref('')
const refundReason = ref('')
const refundBusy = ref(false)
const refundFailure = ref<string | undefined>()
const refundValid = computed(() => validRefundDraft({ reference: refundReference.value, reason: refundReason.value }))
// A bank transfer the vendor saw arrive: reference, the exact amount and the day the money reached the account.
const transferOpen = ref(false)
const transferReference = ref('')
const transferAmount = ref('')
const transferDate = ref('')
const transferBusy = ref(false)
const transferFailure = ref<string | undefined>()
const transferParsed = computed(() => parseTransferAmount(transferAmount.value, data.value?.total.exponent ?? 2))
// A typed amount the form cannot read says so; an empty one waits for the vendor.
const transferAmountError = computed(() => {
  if (!transferAmount.value.trim() || 'minor' in transferParsed.value) return undefined
  return t(transferParsed.value.issue === 'decimals' ? 'vendor.invoices.transfer.amountDecimals' : 'vendor.invoices.transfer.amountInvalid')
})
const transferValid = computed(() => transferReference.value.trim().length >= 3 && 'minor' in transferParsed.value && /^\d{4}-\d{2}-\d{2}$/.test(transferDate.value))
function openTransfer() {
  transferOpen.value = true; transferFailure.value = undefined; transferReference.value = ''
  // The invoice total is pre-filled (a transfer that does not match it is refused), on today's date in Riyadh.
  const start = data.value ? transferFormDefaults(data.value.total) : { amount: '', valueDate: '' }
  transferAmount.value = start.amount; transferDate.value = start.valueDate
}
function closeTransfer() { transferOpen.value = false; transferFailure.value = undefined }
async function recordTransfer() {
  const amount = transferParsed.value
  if (!hydrated.value || transferBusy.value || !canBilling.value || !transferValid.value || !data.value || !('minor' in amount)) return
  transferBusy.value = true; transferFailure.value = undefined
  try {
    await api.recordBankTransfer(data.value.id, { reference: transferReference.value, amount: amount.minor, value_date: transferDate.value })
    closeTransfer()
  } catch (cause) { transferFailure.value = t(commercialErrorKey(cause)) }
  finally { try { await refresh() } finally { transferBusy.value = false } }
}
function openRefund(noteId: string) { refundNoteId.value = noteId; refundReference.value = ''; refundReason.value = ''; refundFailure.value = undefined }
function closeRefund() { refundNoteId.value = null; refundReference.value = ''; refundReason.value = ''; refundFailure.value = undefined }
async function recordRefund() {
  if (!hydrated.value || refundBusy.value || !canRecordRefund.value || !refundNoteId.value || !refundValid.value) return
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
    <SharedRecordSection :title="t('vendor.invoices.lines')"><SharedInvoiceLines :lines="vendorInvoiceLineViews(data.lines, t, locale)" :totals="totals" /></SharedRecordSection>

    <UAlert v-if="refundEligibility" color="neutral" variant="subtle" icon="i-lucide-info" data-testid="refund-window"
      :title="refundEligibility.firstPayment ? t('vendor.invoices.refund.firstPayment') : t('vendor.invoices.refund.firstPaymentNo')"
      :description="refundEligibility.label" />

    <!-- Only a paid invoice can be refunded; the server judges the window, the first payment and a note already made. -->
    <SharedRecordSection v-if="canBilling && data.status === 'paid'" :title="t('vendor.invoices.refund.request.title')">
      <p class="text-sm text-muted">{{ t('vendor.invoices.refund.request.hint') }}</p>
      <SharedInlineConfirm v-if="requestOpen && canRequestRefund" :title="t('vendor.invoices.refund.request.confirmTitle')" :description="t('vendor.invoices.refund.request.confirmHint')"
        :confirm-label="t('vendor.invoices.refund.request.confirm')" :pending="requestBusy" :disabled="!hydrated || requestBusy || !requestValid" @confirm="requestRefund" @cancel="closeRequest">
        <div class="mt-3 space-y-4">
          <UFormField v-if="requestNeedsUnits" :label="t('vendor.invoices.refund.request.unitsUsed')" :help="t('vendor.invoices.refund.request.unitsUsedHint')" :error="requestUnitsError" required><UInput v-model="requestUnitsUsed" inputmode="numeric" dir="ltr" :disabled="!hydrated || requestBusy" class="w-full" data-testid="request-units-used" /></UFormField>
          <UFormField :label="t('vendor.invoices.refund.reason')" required><UTextarea v-model="requestReason" :maxlength="1000" :disabled="!hydrated || requestBusy" class="w-full" /></UFormField>
        </div>
      </SharedInlineConfirm>
      <div v-else class="flex flex-wrap items-center gap-3">
        <UButton color="primary" variant="soft" size="sm" :disabled="!hydrated || requestBusy || !canRequestRefund" :aria-describedby="requestBlock ? 'refund-request-blocked' : undefined" data-testid="request-refund-action" @click="openRequest">{{ t('vendor.invoices.refund.request.action') }}</UButton>
        <p v-if="requestBlock" id="refund-request-blocked" class="text-sm text-muted" data-testid="refund-request-blocked">{{ requestBlockText }}</p>
      </div>
      <UAlert v-if="requestFailure" class="mt-3" color="error" variant="subtle" :title="requestFailure" data-testid="request-refund-failure" />
    </SharedRecordSection>

    <!-- Only an issued (unpaid) invoice can still receive a transfer. -->
    <SharedRecordSection v-if="canBilling && data.status === 'issued'" :title="t('vendor.invoices.transfer.title')">
      <p class="text-sm text-muted">{{ t('vendor.invoices.transfer.hint') }}</p>
      <SharedInlineConfirm v-if="transferOpen" :title="t('vendor.invoices.transfer.title')" :description="t('vendor.invoices.transfer.confirmHint')"
        :confirm-label="t('vendor.invoices.transfer.confirm')" :pending="transferBusy" :disabled="!hydrated || transferBusy || !transferValid"
        @confirm="recordTransfer" @cancel="closeTransfer">
        <div class="mt-3 grid gap-4 sm:grid-cols-3">
          <UFormField :label="t('vendor.invoices.transfer.reference')" required><UInput v-model="transferReference" :maxlength="200" dir="ltr" :disabled="!hydrated || transferBusy" class="w-full" /></UFormField>
          <UFormField :label="t('vendor.invoices.transfer.amount')" :help="t('vendor.invoices.transfer.amountHint')" :error="transferAmountError" required><UInput v-model="transferAmount" inputmode="decimal" dir="ltr" :disabled="!hydrated || transferBusy" class="w-full" /></UFormField>
          <UFormField :label="t('vendor.invoices.transfer.valueDate')" required><UInput v-model="transferDate" type="date" dir="ltr" :disabled="!hydrated || transferBusy" class="w-full" /></UFormField>
        </div>
      </SharedInlineConfirm>
      <UButton v-else color="primary" variant="soft" size="sm" :disabled="!hydrated || transferBusy" data-testid="bank-transfer-action" @click="openTransfer">{{ t('vendor.invoices.transfer.action') }}</UButton>
      <UAlert v-if="transferFailure" class="mt-3" color="error" variant="subtle" :title="transferFailure" data-testid="transfer-failure" />
    </SharedRecordSection>

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
              <span class="text-sm text-muted" data-testid="adjustment-origin">{{ t(`vendor.invoices.adjustmentOrigin.${note.origin}`) }}</span>
            </div>
            <span class="tabular-nums">{{ money(note.amount) }}</span>
          </div>
          <p class="text-sm">{{ note.reason }}</p>
          <dl v-if="note.status === 'refunded'" class="grid gap-2 text-sm sm:grid-cols-3" data-testid="refund-record">
            <div><dt class="text-muted">{{ t('vendor.invoices.refund.reference') }}</dt><dd><bdi dir="ltr">{{ note.refund_reference }}</bdi></dd></div>
            <div><dt class="text-muted">{{ t('vendor.invoices.refund.at') }}</dt><dd>{{ note.refunded_at ? attemptTime(note.refunded_at) : '' }}</dd></div>
            <div><dt class="text-muted">{{ t('vendor.invoices.refund.by') }}</dt><dd><bdi dir="ltr">{{ note.refunded_by }}</bdi></dd></div>
          </dl>
          <template v-if="canBilling && note.kind === 'credit_note' && note.status === 'pending'">
            <SharedInlineConfirm v-if="refundNoteId === note.id && canRecordRefund" :title="t('vendor.invoices.refund.title')" :description="t('vendor.invoices.refund.description')" :confirm-label="t('vendor.invoices.refund.confirm')" :pending="refundBusy" :disabled="!hydrated || refundBusy || !refundValid" @confirm="recordRefund" @cancel="closeRefund">
              <div class="mt-3 space-y-4">
                <UFormField :label="t('vendor.invoices.refund.reference')" :help="t('vendor.invoices.refund.referenceHint')" required><UInput v-model="refundReference" :maxlength="200" dir="ltr" :disabled="!hydrated || refundBusy" class="w-full" /></UFormField>
                <UFormField :label="t('vendor.invoices.refund.reason')" required><UTextarea v-model="refundReason" :maxlength="1000" :disabled="!hydrated || refundBusy" class="w-full" /></UFormField>
              </div>
            </SharedInlineConfirm>
            <UButton v-else color="neutral" variant="outline" size="sm" :disabled="!hydrated || refundBusy" data-testid="record-refund-action" @click="openRefund(note.id)">{{ t('vendor.invoices.refund.action') }}</UButton>
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
