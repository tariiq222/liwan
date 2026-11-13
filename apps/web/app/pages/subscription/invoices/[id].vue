<script setup lang="ts">
import { useCustomerCapabilities, useSubscriptionApi } from '@/composables/useSubscription'
import { bankTransferOutcome, formatSubscriptionMoney, invoiceWantsTransfer, refusalCode, refusalKey, riyadhToday, subscriptionInvoiceView, transferClaimState, transferNotice } from '@/utils/subscription'
const { t, locale } = useI18n(); const route = useRoute(); const api = useSubscriptionApi(); const { can } = useCustomerCapabilities()
const allowed = computed(() => can('billing.read'))
const id = computed(() => String(route.params.id ?? ''))
// Another tenant's invoice id answers 404 from the BFF/control plane; SharedPageState shows "not found", never the data.
const { data, error, pending, refresh } = await useAsyncData(() => `subscription:invoice:${id.value}`, () => api.invoice(id.value), { immediate: allowed.value, watch: [id] })
const view = computed(() => data.value ? subscriptionInvoiceView(data.value, t, locale.value) : null)
// Where to transfer while the invoice is unpaid. The control plane answers 409 `bank_account_unavailable` until the
// vendor fills the account in: that is "not configured", not a failure. Any other refusal is a real error worth showing.
const wantsTransfer = computed(() => invoiceWantsTransfer(allowed.value, data.value))
// The fetch returns the whole answer (instructions and which notice to show) so the server payload alone is enough on
// the client: a component-local ref set inside the fetcher would be lost when the payload is reused without running it.
const { data: answer } = await useAsyncData(() => `subscription:invoice-transfer:${id.value}`, async () => {
  if (!wantsTransfer.value) return { instructions: null, notice: 'none' as const }
  const result = await api.bankTransfer(id.value).then(instructions => ({ instructions }), (cause: unknown) => ({ cause }))
  const outcome = bankTransferOutcome(wantsTransfer.value, result)
  return { instructions: outcome.kind === 'instructions' ? outcome.instructions : null, notice: transferNotice(outcome) }
}, { immediate: allowed.value, watch: [wantsTransfer] })
const transfer = computed(() => answer.value?.instructions ?? null)
const transferState = computed(() => answer.value?.notice ?? 'none')
const amount = computed(() => (transfer.value ? formatSubscriptionMoney({ currency: transfer.value.currency, exponent: transfer.value.exponent, minor: transfer.value.amount_minor }, locale.value) : ''))
const instructions = computed(() => (transfer.value ? (locale.value.startsWith('ar') ? transfer.value.bank.instructions_ar : transfer.value.bank.instructions_en) : ''))
// "I made the transfer": the customer's own claim comes with the instructions; a fresh answer replaces it until the next load.
const canManage = computed(() => can('subscription.manage'))
const claimed = ref<NonNullable<typeof transfer.value>['claim']>(null)
const claim = computed(() => claimed.value ?? transfer.value?.claim ?? null)
const claimState = computed(() => transferClaimState(claim.value, locale.value))
const claimDate = ref(''), claimSender = ref(''), claimError = ref(''), claimBusy = ref(false)
const today = riyadhToday()
async function submitClaim() {
  claimError.value = ''; claimBusy.value = true
  try { claimed.value = await api.claimBankTransfer(id.value, { value_date: claimDate.value, ...(claimSender.value.trim() ? { sender_reference: claimSender.value.trim() } : {}) }) }
  catch (cause) { claimError.value = t(refusalKey(refusalCode(cause)) ?? 'subscription.bankTransfer.claim.failed') }
  finally { claimBusy.value = false }
}
const copied = ref('')
async function copy(value: string, key: string) {
  try { await navigator.clipboard.writeText(value); copied.value = key } catch { copied.value = '' }
}
definePageMeta({ middleware: 'customer-commercial' })
</script>
<template>
  <SharedRecordPage  :title="data?.number ?? t('subscription.invoices.title')" back-to="/subscription/invoices" :back-label="t('subscription.invoices.back')"  :loading="allowed && pending" :error="allowed ? error : undefined" @retry="refresh">

    <SharedForbiddenState v-if="!allowed" />
    <template v-else-if="view">
      <div class="flex justify-end">
        <UButton color="neutral" variant="outline" icon="i-lucide-file-down" :to="`/subscription/invoices/print/${encodeURIComponent(id)}`" :label="t('subscription.invoices.print.download')" data-testid="invoice-download" />
      </div>
      <SharedInvoiceLines layout="list" v-bind="view" />
      <UAlert v-if="transferState === 'failed'" color="error" variant="subtle" :title="t('subscription.bankTransfer.error')" data-testid="bank-transfer-error" />
      <p v-else-if="transferState === 'unavailable'" class="text-sm text-muted" data-testid="bank-transfer-unavailable">{{ t('subscription.bankTransfer.unavailable') }}</p>
      <SharedRecordSection v-if="transfer" :title="t('subscription.bankTransfer.title')" data-testid="bank-transfer">
        <p class="text-sm text-muted">{{ t('subscription.bankTransfer.hint') }}</p>
        <p v-if="instructions" class="text-sm">{{ instructions }}</p>
        <dl class="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt class="text-muted">{{ t('subscription.bankTransfer.reference') }}</dt><dd><bdi dir="ltr">{{ transfer.reference }}</bdi></dd></div>
          <div><dt class="text-muted">{{ t('subscription.bankTransfer.amount') }}</dt><dd><bdi dir="ltr">{{ amount }}</bdi></dd></div>
          <div><dt class="text-muted">{{ t('subscription.bankTransfer.account') }}</dt><dd>{{ transfer.bank.account_name }}</dd></div>
          <div><dt class="text-muted">{{ t('subscription.bankTransfer.accountNumber') }}</dt><dd><bdi dir="ltr">{{ transfer.bank.account_number }}</bdi></dd></div>
          <div class="sm:col-span-2"><dt class="text-muted">{{ t('subscription.bankTransfer.iban') }}</dt><dd class="flex flex-wrap items-center gap-2"><bdi dir="ltr">{{ transfer.bank.iban }}</bdi><UButton size="xs" color="neutral" variant="outline" @click="copy(transfer.bank.iban, 'iban')">{{ t('subscription.bankTransfer.copy') }}</UButton><span v-if="copied === 'iban'" class="text-xs text-muted">{{ t('subscription.bankTransfer.copied') }}</span></dd></div>
        </dl>
      </SharedRecordSection>
      <SharedRecordSection v-if="transfer && claimState.stage === 'awaiting'" :title="t('subscription.bankTransfer.claim.awaiting', { date: claimState.since })" data-testid="bank-transfer-awaiting">
        <p class="text-sm text-muted">{{ t('subscription.bankTransfer.claim.awaitingDetail', { date: claimState.valueDate }) }}</p>
        <p v-if="claimState.reference" class="text-sm text-muted">{{ t('subscription.bankTransfer.claim.awaitingReference', { reference: claimState.reference }) }}</p>
      </SharedRecordSection>
      <SharedRecordSection v-if="transfer && canManage" :title="claimState.stage === 'awaiting' ? t('subscription.bankTransfer.claim.update') : t('subscription.bankTransfer.claim.title')" data-testid="bank-transfer-claim">
        <p v-if="claimState.stage === 'instructions'" class="text-sm text-muted">{{ t('subscription.bankTransfer.claim.hint') }}</p>
        <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="submitClaim">
          <UFormField :label="t('subscription.bankTransfer.claim.date')"><UInput v-model="claimDate" type="date" :max="today" required class="w-full" /></UFormField>
          <UFormField :label="t('subscription.bankTransfer.claim.sender')"><UInput v-model="claimSender" maxlength="200" class="w-full" /></UFormField>
          <div class="sm:col-span-2"><UButton type="submit" :loading="claimBusy" :disabled="!claimDate">{{ claimState.stage === 'awaiting' ? t('subscription.bankTransfer.claim.update') : t('subscription.bankTransfer.claim.submit') }}</UButton></div>
        </form>
        <UAlert v-if="claimError" color="error" variant="subtle" :title="claimError" data-testid="bank-transfer-claim-error" />
      </SharedRecordSection>
    </template>
  </SharedRecordPage>
</template>
