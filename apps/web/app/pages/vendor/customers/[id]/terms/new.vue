<script setup lang="ts">
import type { Quote } from '@nasq/commercial-contracts'
import { commercialErrorKey, commercialFailure } from '@/utils/vendorCommercial'
import { customerQuoteBody, customersReturnTo, termsOnly, termsPayload, type TermsDraft } from '@/utils/vendorSubscriptions'
import { useVendorSubscriptions } from '@/composables/useVendorSubscriptions'
definePageMeta({ middleware: 'vendor', vendorCapability: 'vendor.pricing.manage' })
const { t } = useI18n(); const route = useRoute(); const { can } = useVendorContext(); const api = useVendorSubscriptions()
const id = computed(() => String(route.params.id))
const backTo = computed(() => customersReturnTo(route.query.returnTo))
const detailTo = computed(() => ({ path: `/vendor/customers/${encodeURIComponent(id.value)}`, query: { returnTo: backTo.value } }))
const { data: customer, error, pending, refresh } = await useAsyncData(() => `vendor:terms-customer:${id.value}`, () => api.customer(id.value))
const sub = computed(() => customer.value?.subscription ?? null)
const allowed = computed(() => can('vendor.pricing.manage') && can('vendor.subscriptions.manage'))
const before = ref<Quote | null>(null); const after = ref<Quote | null>(null)
const saved = ref<string | null>(null); const previewing = ref(false); const previewError = ref<string | undefined>(); const busy = ref(false); const saveError = ref<unknown>(null); const resetKey = ref(0)
let seq = 0
async function preview(draft: TermsDraft) {
  if (!sub.value) return
  const mine = ++seq; previewing.value = true; previewError.value = undefined
  try {
    const full = await api.subscription(sub.value.id)
    const terms = termsOnly(termsPayload(id.value, { ...draft, reason: draft.reason.trim().length >= 3 ? draft.reason : 'preview' }))
    const [b, a] = await Promise.all([api.customerQuote(customerQuoteBody(id.value, full)), api.customerQuote(customerQuoteBody(id.value, full, { terms }))])
    if (mine === seq) { before.value = b.quote; after.value = a.quote; saved.value = null }
  } catch (cause) { if (mine === seq) previewError.value = t(commercialErrorKey(cause)) } finally { if (mine === seq) previewing.value = false }
}
async function save(draft: TermsDraft) {
  if (busy.value || !allowed.value) return
  busy.value = true; saveError.value = null
  try {
    const rev = await api.saveTerms(termsPayload(id.value, draft))
    saved.value = rev.id; resetKey.value++; await nextTick(); await refreshNuxtData()
  } catch (cause) { saveError.value = commercialFailure(cause).code === 'unknown' && cause instanceof Error && cause.message.startsWith('invalid_') ? { code: 'invalid' } : cause } finally { busy.value = false }
}
</script>
<template>
  <SharedCreatePanel :title="t('vendor.customers.customizeTerms')" :back-to="detailTo" width="wide">
    <SharedPageState :loading="pending" :error="error" @retry="refresh">
      <SharedForbiddenState v-if="!allowed" />
      <UAlert v-else-if="!sub" color="neutral" variant="subtle" :title="t('vendor.customers.terms.needsSubscription')" />
      <div v-else class="space-y-6">
        <VendorCustomerTermsForm :busy="busy" :previewing="previewing" :error="saveError" :reset-key="resetKey" @preview="preview" @save="save" @cancel="navigateTo(detailTo)" />
        <UAlert v-if="saved" color="success" variant="subtle" icon="i-lucide-check" :title="t('vendor.customers.terms.saved')" :description="t('vendor.customers.terms.savedHint')" data-testid="terms-saved" />
        <UAlert v-if="previewError" color="error" variant="subtle" :title="previewError" />
        <div v-if="before || after" class="grid gap-4 lg:grid-cols-2" data-testid="terms-impact">
          <section><h3 class="mb-2 font-semibold">{{ t('vendor.customers.terms.before') }}</h3><VendorPriceBreakdown :quote="before" :pending="previewing" /></section>
          <section><h3 class="mb-2 font-semibold">{{ t('vendor.customers.terms.after') }}</h3><VendorPriceBreakdown :quote="after" :pending="previewing" /></section>
        </div>
      </div>
    </SharedPageState>
  </SharedCreatePanel>
</template>
