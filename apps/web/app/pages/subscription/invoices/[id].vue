<script setup lang="ts">
import { useCustomerCapabilities, useSubscriptionApi } from '@/composables/useSubscription'
import { subscriptionInvoiceView, formatSubscriptionMoney } from '@/utils/subscription'
const { t, locale } = useI18n(); const route = useRoute(); const api = useSubscriptionApi(); const { can } = useCustomerCapabilities()
const allowed = computed(() => can('billing.read'))
const id = computed(() => String(route.params.id ?? ''))
// Another tenant's invoice id answers 404 from the BFF/control plane; SharedPageState shows "not found", never the data.
const { data, error, pending, refresh } = await useAsyncData(() => `subscription:invoice:${id.value}`, () => api.invoice(id.value), { immediate: allowed.value, watch: [id] })
const view = computed(() => data.value ? subscriptionInvoiceView(data.value, t, locale.value) : null)
// Where to transfer while the invoice is unpaid. The control plane answers 409 until the vendor sets the account, and
// the page then simply shows nothing: a customer is never shown a half-configured destination.
const wantsTransfer = computed(() => allowed.value && data.value?.status === 'issued')
const { data: transfer } = await useAsyncData(() => `subscription:invoice-transfer:${id.value}`,
  () => (wantsTransfer.value ? api.bankTransfer(id.value).catch(() => null) : Promise.resolve(null)), { immediate: allowed.value, watch: [wantsTransfer] })
const amount = computed(() => (transfer.value ? formatSubscriptionMoney({ currency: transfer.value.currency, exponent: transfer.value.exponent, minor: transfer.value.amount_minor }, locale.value) : ''))
const instructions = computed(() => (transfer.value ? (locale.value.startsWith('ar') ? transfer.value.bank.instructions_ar : transfer.value.bank.instructions_en) : ''))
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
      <SharedInvoiceLines layout="list" v-bind="view" />
      <SharedRecordSection v-if="transfer" :title="t('subscription.bankTransfer.title')" data-testid="bank-transfer">
        <p class="text-sm text-muted">{{ t('subscription.bankTransfer.hint') }}</p>
        <p v-if="instructions" class="text-sm">{{ instructions }}</p>
        <dl class="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt class="text-muted">{{ t('subscription.bankTransfer.reference') }}</dt><dd><bdi dir="ltr">{{ transfer.reference }}</bdi></dd></div>
          <div><dt class="text-muted">{{ t('subscription.bankTransfer.amount') }}</dt><dd><bdi dir="ltr">{{ amount }}</bdi></dd></div>
          <div><dt class="text-muted">{{ t('subscription.bankTransfer.account') }}</dt><dd>{{ transfer.bank.account_name }}</dd></div>
          <div><dt class="text-muted">{{ t('subscription.bankTransfer.accountNumber') }}</dt><dd><bdi dir="ltr">{{ transfer.bank.account_number }}</bdi></dd></div>
          <div class="sm:col-span-2"><dt class="text-muted">{{ t('subscription.bankTransfer.iban') }}</dt><dd class="flex flex-wrap items-center gap-2"><bdi dir="ltr">{{ transfer.bank.iban }}</bdi><UButton size="xs" color="neutral" variant="outline" @click="copy(transfer.bank.iban, 'iban')">{{ t('app.copy') }}</UButton><span v-if="copied === 'iban'" class="text-xs text-muted">{{ t('app.copied') }}</span></dd></div>
        </dl>
      </SharedRecordSection>
    </template>
  </SharedRecordPage>
</template>
