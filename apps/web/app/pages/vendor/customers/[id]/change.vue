<script setup lang="ts">
import type { Quote } from '@nasq/commercial-contracts'
import { commercialErrorKey, parseCount } from '@/utils/vendorCommercial'
import { customerQuoteBody, customersReturnTo } from '@/utils/vendorSubscriptions'
import { useVendorSubscriptions } from '@/composables/useVendorSubscriptions'
import { useVendorCommercial } from '@/composables/useVendorCommercial'
definePageMeta({ middleware: 'vendor', vendorCapability: 'vendor.subscriptions.manage' })
const { t } = useI18n(); const route = useRoute(); const { can } = useVendorContext(); const api = useVendorSubscriptions(); const catalog = useVendorCommercial(); const hydrated = useHydrated()
const id = computed(() => String(route.params.id))
const backTo = computed(() => customersReturnTo(route.query.returnTo))
const detailTo = computed(() => ({ path: `/vendor/customers/${encodeURIComponent(id.value)}`, query: { returnTo: backTo.value } }))
const { data, error, pending, refresh } = await useAsyncData(() => `vendor:change:${id.value}`, async () => {
  const customer = await api.customer(id.value)
  const sub = customer?.subscription ? await api.subscription(customer.subscription.id) : null
  const plans = await catalog.listPlans({ status: 'published', limit: 200 }).then(r => r.items).catch(() => [])
  return { customer, sub, plans }
})
const planId = ref(''); const extra = ref('')
watch(data, d => { if (d?.sub && !planId.value) { planId.value = (d.sub.target ?? d.sub.applied)?.plan_revision_id ?? ''; extra.value = String((d.sub.target ?? d.sub.applied)?.extra_branch_count ?? 0) } }, { immediate: true })
const planItems = computed(() => (data.value?.plans ?? []).map(p => ({ label: p.name, value: p.id })))
const quote = ref<Quote | null>(null); const quoting = ref(false); const failure = ref<string | undefined>(); const busy = ref(false);
async function recompute() {
  const sub = data.value?.sub; const n = parseCount(extra.value)
  if (!sub || !planId.value || n === null) return
  quoting.value = true; failure.value = undefined
  try { quote.value = await api.changeQuote(customerQuoteBody(id.value, sub, { planRevisionId: planId.value, extraBranches: n })) } catch (cause) { quote.value = null; failure.value = (cause as { code?: string })?.code === 'preview_quote' ? t('vendor.customers.change.previewRejected') : t(commercialErrorKey(cause)) } finally { quoting.value = false }
}
async function place() {
  const sub = data.value?.sub
  if (!hydrated.value || busy.value || !quote.value || (quote.value as { preview?: boolean }).preview || !sub || !can('vendor.subscriptions.manage')) return
  busy.value = true; failure.value = undefined
  try {
    await api.placeOrder({ quote_id: quote.value.id, expected_subscription_revision: sub.revision, idempotency_key: crypto.randomUUID() })
    await refreshNuxtData(); await navigateTo(detailTo.value)
  } catch (cause) { failure.value = t(commercialErrorKey(cause)) } finally { busy.value = false }
}
</script>
<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('vendor.customers.changeSubscription')" :description="t('vendor.customers.change.description')" :back-to="detailTo" />
    <SharedPageState :loading="pending" :error="error" @retry="refresh">
      <p v-if="!can('vendor.subscriptions.manage')">{{ t('vendor.forbidden') }}</p>
      <UAlert v-else-if="!data?.sub" color="neutral" variant="subtle" :title="t('vendor.customers.terms.needsSubscription')" />
      <form v-else class="space-y-5" novalidate @submit.prevent="place">
        <UAlert color="info" variant="subtle" icon="i-lucide-user-cog" :title="t('vendor.customers.change.onBehalf')" />
        <UFormField :label="t('vendor.customers.plan')"><USelect v-model="planId" :items="planItems" class="w-full" :disabled="!hydrated" @update:model-value="quote = null" /></UFormField>
        <UFormField :label="t('vendor.customers.change.extraBranches')"><UInput v-model="extra" dir="ltr" inputmode="numeric" class="w-full sm:w-48" :disabled="!hydrated" @update:model-value="quote = null" /></UFormField>
        <div><UButton color="neutral" variant="outline" :loading="quoting" :disabled="!hydrated || quoting" @click="recompute">{{ t('vendor.customers.change.quote') }}</UButton></div>
        <VendorPriceBreakdown :quote="quote" :pending="quoting" :error="failure" @retry="recompute" />
        <div class="flex justify-end"><UButton type="submit" :loading="busy" :disabled="!hydrated || busy || !quote">{{ t('vendor.customers.change.place') }}</UButton></div>
      </form>
    </SharedPageState>
  </SharedPageContainer>
</template>
