<script setup lang="ts">
import type { Quote } from '@liwan/commercial-contracts'
import { cadenceKey, commercialErrorKey, parseCount } from '@/utils/vendorCommercial'
import { cadenceLabel } from '@liwan/commercial-ui/app/utils/commercial'
import { customerQuoteBody, customersReturnTo, orderOutcomeUnknown } from '@/utils/vendorSubscriptions'
import { useVendorSubscriptions } from '@/composables/useVendorSubscriptions'
import { useVendorCommercial } from '@/composables/useVendorCommercial'
definePageMeta({ capability: 'vendor.subscriptions.manage' })
const { t } = useI18n(); const route = useRoute(); const { can } = useVendorContext(); const api = useVendorSubscriptions(); const catalog = useVendorCommercial(); const hydrated = useHydrated()
const id = computed(() => String(route.params.id))
const backTo = computed(() => customersReturnTo(route.query.returnTo))
const detailTo = computed(() => ({ path: `/customers/${encodeURIComponent(id.value)}`, query: { tab: 'subscription', returnTo: backTo.value } }))
const { data, error, pending, refresh } = await useAsyncData(() => `vendor:change:${id.value}`, async () => {
  const customer = await api.customer(id.value)
  const sub = customer?.subscription ? await api.subscription(customer.subscription.id) : null
  const plans = await catalog.listPlans({ status: 'published', limit: 200, customer_id: id.value }).then(r => r.items).catch(() => [])
  return { customer, sub, plans }
})
const planId = ref(''); const extra = ref('0'); const cadence = ref(''); const onboarding = ref(false)
const isInitial = computed(() => !data.value?.sub?.applied && !data.value?.sub?.target)
watch(data, d => { if (d?.sub && !planId.value) { planId.value = (d.sub.target ?? d.sub.applied)?.plan_revision_id ?? ''; extra.value = String((d.sub.target ?? d.sub.applied)?.extra_branch_count ?? 0) } }, { immediate: true })
// A vendor-added customer never starts a trial: a first order is a package the vendor collects (trial plans have their own panel on the customer page).
const planItems = computed(() => (data.value?.plans ?? []).filter(p => !isInitial.value || p.trial_days === 0).map(p => ({ label: p.name, value: p.id })))
const selectedPlan = computed(() => data.value?.plans.find(p => p.id === planId.value))
const cadenceItems = computed(() => (selectedPlan.value?.prices ?? []).map(p => ({ label: cadenceLabel(p.cadence, t), value: cadenceKey(p.cadence) })))
const selectedCadence = computed(() => selectedPlan.value?.prices.find(p => cadenceKey(p.cadence) === cadence.value)?.cadence)
const quote = ref<Quote | null>(null); const orderKey = ref<string | null>(null); const quoting = ref(false); const failure = ref<string | undefined>(); const busy = ref(false)
function resetQuote() { quote.value = null; orderKey.value = null }
watch(planId, () => { cadence.value = ''; resetQuote() })
async function recompute() {
  const sub = data.value?.sub ?? null; const n = parseCount(extra.value)
  if (!hydrated.value || quoting.value || busy.value || sub?.pending_order || !data.value?.customer || !planId.value || n === null || (isInitial.value && (!selectedPlan.value || !selectedCadence.value))) return
  quoting.value = true; resetQuote(); failure.value = undefined
  try {
    quote.value = await api.changeQuote(customerQuoteBody(id.value, sub, { planRevisionId: planId.value, extraBranches: n, ...(isInitial.value ? { bundleIds: selectedPlan.value!.included_bundle_revision_ids, cadence: selectedCadence.value!, users: selectedPlan.value!.included_users, storageMb: selectedPlan.value!.included_storage_mb, ...(onboarding.value ? { onboarding: true } : {}) } : {}) }))
    orderKey.value = crypto.randomUUID()
  } catch (cause) { failure.value = (cause as { code?: string })?.code === 'preview_quote' ? t('vendor.customers.change.previewRejected') : t(commercialErrorKey(cause)) } finally { quoting.value = false }
}
// One key per quoted order: a retry after a lost answer returns the order already placed; the next quote gets its own key.
async function place() {
  const sub = data.value?.sub
  if (!hydrated.value || busy.value || quoting.value || !quote.value || !orderKey.value || (quote.value as { preview?: boolean }).preview || sub?.pending_order || !can('vendor.subscriptions.manage')) return
  busy.value = true; failure.value = undefined
  try {
    await api.placeOrder({ quote_id: quote.value.id, expected_subscription_revision: sub?.revision ?? 0, idempotency_key: orderKey.value })
    await refreshNuxtData(); await navigateTo(detailTo.value)
  } catch (cause) {
    if (!orderOutcomeUnknown(cause)) resetQuote()
    failure.value = t(commercialErrorKey(cause))
  } finally { busy.value = false }
}
</script>
<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="isInitial ? t('vendor.customers.firstSubscription') : t('vendor.customers.changeSubscription')" :back-to="detailTo" />
    <SharedPageState :loading="pending" :error="error" @retry="refresh">
      <SharedForbiddenState v-if="!can('vendor.subscriptions.manage')" />
      <UAlert v-else-if="!data?.customer" color="neutral" variant="subtle" :title="t('vendor.pricing.errors.not_found')" />
      <UAlert v-else-if="data.sub?.pending_order" color="warning" variant="subtle" :title="t('vendor.customers.change.pendingOrder')" />
      <form v-else class="space-y-5" novalidate @submit.prevent="place">
        <UAlert color="info" variant="subtle" icon="i-lucide-user-cog" :title="t(isInitial ? 'vendor.customers.change.firstOnBehalf' : 'vendor.customers.change.onBehalf')" />
        <UFormField :label="t('vendor.customers.plan')"><USelect v-model="planId" :items="planItems" class="w-full" :disabled="!hydrated || quoting || busy" @update:model-value="resetQuote" /></UFormField>
        <UFormField v-if="isInitial" :label="t('vendor.customers.change.cadence')" required><USelect v-model="cadence" :items="cadenceItems" class="w-full" :disabled="!hydrated || quoting || busy || !selectedPlan" @update:model-value="resetQuote" /></UFormField>
        <UFormField :label="t('vendor.customers.change.extraBranches')"><UInput v-model="extra" dir="ltr" inputmode="numeric" class="w-full sm:w-48" :disabled="!hydrated || quoting || busy" @update:model-value="resetQuote" /></UFormField>
        <!-- The assisted onboarding is an optional one-time line on a first invoice, never on a change or a renewal. -->
        <UCheckbox v-if="isInitial" v-model="onboarding" :label="t('vendor.customers.newPage.onboarding')" :help="t('vendor.customers.newPage.onboardingHint')" :disabled="!hydrated || quoting || busy" data-testid="onboarding-choice" @update:model-value="resetQuote" />
        <div><UButton color="neutral" variant="outline" :loading="quoting" :disabled="!hydrated || quoting || busy || !planId || (isInitial && !selectedCadence)" @click="recompute">{{ t('vendor.customers.change.quote') }}</UButton></div>
        <SharedCommercePriceBreakdown :quote="quote" :pending="quoting" :error="failure" @retry="recompute" />
        <div class="flex justify-end"><UButton type="submit" :loading="busy" :disabled="!hydrated || busy || quoting || !quote">{{ t('vendor.customers.change.place') }}</UButton></div>
      </form>
    </SharedPageState>
  </SharedPageContainer>
</template>
