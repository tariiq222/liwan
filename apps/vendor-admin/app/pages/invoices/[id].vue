<script setup lang="ts">
import { invoiceStatusBadge } from '@liwan/commercial-ui/app/utils/commercialBadges'
import { adjustmentStatusBadge, paymentAttemptBadge } from '@/utils/vendorBadges'
import { formatCommercialMoney } from '@liwan/commercial-ui/app/utils/commercial'
import { commercialErrorKey } from '@/utils/vendorCommercial'
import { invoicesReturnTo, isNotAvailable, refundErrorKey, validRefundDraft, vendorInvoiceLineViews } from '@/utils/vendorSubscriptions'
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
/** The server's own eligibility verdict: the refund action is never offered past it, so the UI cannot bypass the rule. */
const refundable = computed(() => data.value?.refund?.refundable === true)
const canRefund = computed(() => canBilling.value && !unavailable.value && refundable.value)
/** The stated eligibility of the customer's payment: first payment or not, and the deadline or the closed window. */
const refundEligibility = computed(() => {
  const refund = data.value?.refund
  if (!refund) return null
  const label = refund.refundable ? t('vendor.invoices.refund.eligibilityRefundable', { date: refundUntil.value })
    : refund.first_payment ? t('vendor.invoices.refund.windowClosed', { days: refund.window_days })
      : t('vendor.invoices.refund.notFirstPayment')
  return { firstPayment: refund.first_payment, refundable: refund.refundable, label }
})
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
const transferValid = computed(() => transferReference.value.trim().length >= 3 && /^\d+(\.\d+)?$/.test(transferAmount.value.trim()) && /^\d{4}-\d{2}-\d{2}$/.test(transferDate.value))
function openTransfer() {
  transferOpen.value = true; transferFailure.value = undefined
  transferReference.value = ''; transferDate.value = new Date().toISOString().slice(0, 10)
  // The invoice total is pre-filled: a transfer that does not match it is refused.
  transferAmount.value = data.value ? String(data.value.total.minor / 10 ** data.value.total.exponent) : ''
}
function closeTransfer() { transferOpen.value = false; transferFailure.value = undefined }
async function recordTransfer() {
  if (!hydrated.value || transferBusy.value || !canBilling.value || !transferValid.value || !data.value) return
  transferBusy.value = true; transferFailure.value = undefined
  try {
    await api.recordBankTransfer(data.value.id, { reference: transferReference.value, amount: Math.round(Number(transferAmount.value) * 10 ** data.value.total.exponent), value_date: transferDate.value })
    closeTransfer()
  } catch (cause) { transferFailure.value = t(commercialErrorKey(cause)) }
  finally { try { await refresh() } finally { transferBusy.value = false } }
}
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
    <SharedRecordSection :title="t('vendor.invoices.lines')"><SharedInvoiceLines :lines="vendorInvoiceLineViews(data.lines, t, locale)" :totals="totals" /></SharedRecordSection>

    <UAlert v-if="refundEligibility" color="neutral" variant="subtle" icon="i-lucide-info" data-testid="refund-window"
      :title="refundEligibility.firstPayment ? t('vendor.invoices.refund.firstPayment') : t('vendor.invoices.refund.firstPaymentNo')"
      :description="refundEligibility.label" />

    <!-- Only an issued (unpaid) invoice can still receive a transfer. -->
    <SharedRecordSection v-if="canBilling && data.status === 'issued'" :title="t('vendor.invoices.transfer.title')">
      <p class="text-sm text-muted">{{ t('vendor.invoices.transfer.hint') }}</p>
      <SharedInlineConfirm v-if="transferOpen" :title="t('vendor.invoices.transfer.title')" :description="t('vendor.invoices.transfer.confirmHint')"
        :confirm-label="t('vendor.invoices.transfer.confirm')" :pending="transferBusy" :disabled="!hydrated || transferBusy || !transferValid"
        @confirm="recordTransfer" @cancel="closeTransfer">
        <div class="mt-3 grid gap-4 sm:grid-cols-3">
          <UFormField :label="t('vendor.invoices.transfer.reference')" required><UInput v-model="transferReference" :maxlength="200" dir="ltr" :disabled="!hydrated || transferBusy" class="w-full" /></UFormField>
          <UFormField :label="t('vendor.invoices.transfer.amount')" required><UInput v-model="transferAmount" inputmode="decimal" dir="ltr" :disabled="!hydrated || transferBusy" class="w-full" /></UFormField>
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
            <SharedInlineConfirm v-if="refundNoteId === note.id && canRefund" :title="t('vendor.invoices.refund.title')" :description="t('vendor.invoices.refund.description')" :confirm-label="t('vendor.invoices.refund.confirm')" :pending="refundBusy" :disabled="!hydrated || refundBusy || !refundValid" @confirm="recordRefund" @cancel="closeRefund">
              <div class="mt-3 space-y-4">
                <UFormField :label="t('vendor.invoices.refund.reference')" :help="t('vendor.invoices.refund.referenceHint')" required><UInput v-model="refundReference" :maxlength="200" dir="ltr" :disabled="!hydrated || refundBusy" class="w-full" /></UFormField>
                <UFormField :label="t('vendor.invoices.refund.reason')" required><UTextarea v-model="refundReason" :maxlength="1000" :disabled="!hydrated || refundBusy" class="w-full" /></UFormField>
              </div>
            </SharedInlineConfirm>
            <!-- The server decides eligibility; a closed window or a later payment disables the action and says why. -->
            <div v-else class="flex flex-wrap items-center gap-3">
              <UButton color="neutral" variant="outline" size="sm" :disabled="!hydrated || refundBusy || !canRefund" data-testid="record-refund-action" @click="openRefund(note.id)">{{ t('vendor.invoices.refund.action') }}</UButton>
              <p v-if="!refundable" class="text-sm text-muted" data-testid="refund-ineligible">{{ refundEligibility?.label }}</p>
            </div>
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
