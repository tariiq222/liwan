<script setup lang="ts">
import type { Quote } from '@liwan/commercial-contracts'
import { cadenceKey, commercialErrorKey, parseCount } from '@/utils/vendorCommercial'
import { cadenceLabel } from '@liwan/commercial-ui/app/utils/commercial'
import { currentPaidQuantities, customerQuoteBody, customersReturnTo, orderOutcomeUnknown, planBundleIds, requestedQuantities } from '@/utils/vendorSubscriptions'
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
  const plans = await catalog.listPlans({ status: 'published', limit: 200, customer_id: id.value }).then(r => r.items)
  const bundles = await catalog.listBundles({ status: 'published', limit: 200, customer_id: id.value }).then(r => r.items)
  return { customer, sub, plans, bundles }
})
const planId = ref(''); const cadence = ref(''); const extra = ref('0'); const paidUsers = ref('0'); const paidStorage = ref('0'); const chosenBundles = ref<string[]>([]); const onboarding = ref(false)
// What the form held when it opened (the current subscription, or empty for a first one): a change from it, or a placed order, decides the guard.
const formState = computed(() => JSON.stringify([planId.value, cadence.value, extra.value, paidUsers.value, paidStorage.value, chosenBundles.value, onboarding.value]))
const openedWith = ref(formState.value)
const placed = ref(false)
const dirty = computed(() => !placed.value && formState.value !== openedWith.value)
const base = computed(() => data.value?.sub?.target ?? data.value?.sub?.applied ?? null)
const isInitial = computed(() => !base.value)
// A vendor-added customer never starts a trial: a first order is a package the vendor collects (trial plans have their own panel on the customer page).
const planItems = computed(() => (data.value?.plans ?? []).filter(p => !isInitial.value || p.trial_days === 0).map(p => ({ label: p.name, value: p.id })))
const selectedPlan = computed(() => data.value?.plans.find(p => p.id === planId.value))
const cadenceItems = computed(() => (selectedPlan.value?.prices ?? []).map(p => ({ label: cadenceLabel(p.cadence, t), value: cadenceKey(p.cadence) })))
const selectedCadence = computed(() => selectedPlan.value?.prices.find(p => cadenceKey(p.cadence) === cadence.value)?.cadence)
const bundleNames = computed(() => new Map((data.value?.bundles ?? []).map(b => [b.id, b.name])))
// Only optional bundles that are published can be ordered; the plan's included ones come with it.
const optionalBundles = computed(() => (selectedPlan.value?.optional_bundle_revision_ids ?? []).filter(id => bundleNames.value.has(id)).map(id => ({ id, name: bundleNames.value.get(id)! })))
const quote = ref<Quote | null>(null); const orderKey = ref<string | null>(null); const quoting = ref(false); const failure = ref<string | undefined>(); const busy = ref(false)
function resetQuote() { quote.value = null; orderKey.value = null }
/** Choosing a plan keeps what the customer has where the plan offers it: the cadence, their optional bundles and their user and storage totals. */
function choosePlan(id: string) {
  planId.value = id; resetQuote()
  const plan = selectedPlan.value
  if (!plan) { cadence.value = ''; return }
  const keep = cadence.value && plan.prices.some(p => cadenceKey(p.cadence) === cadence.value)
  cadence.value = keep ? cadence.value : ''
  chosenBundles.value = chosenBundles.value.filter(bundle => plan.optional_bundle_revision_ids.includes(bundle))
  const paid = currentPaidQuantities(plan, data.value?.sub ?? null)
  paidUsers.value = String(paid.paidUsers); paidStorage.value = String(paid.paidStorageGb)
}
watch(data, d => {
  if (!d || planId.value) return
  if (base.value) {
    extra.value = String(base.value.extra_branch_count); cadence.value = cadenceKey(base.value.cadence); chosenBundles.value = [...base.value.bundle_revision_ids]
    choosePlan(base.value.plan_revision_id)
    openedWith.value = formState.value
  }
}, { immediate: true })
const counts = computed(() => ({ extra: parseCount(extra.value), users: parseCount(paidUsers.value), storage: parseCount(paidStorage.value) }))
const ready = computed(() => Boolean(selectedPlan.value && selectedCadence.value) && counts.value.extra !== null && counts.value.users !== null && counts.value.storage !== null)
async function recompute() {
  const plan = selectedPlan.value; const cad = selectedCadence.value; const { extra: n, users, storage } = counts.value
  if (!hydrated.value || quoting.value || busy.value || data.value?.sub?.pending_order || !data.value?.customer || !plan || !cad || n === null || users === null || storage === null) return
  quoting.value = true; resetQuote(); failure.value = undefined
  const { users: requestedUsers, storageMb } = requestedQuantities(plan, { paidUsers: users, paidStorageGb: storage })
  try {
    quote.value = await api.changeQuote(customerQuoteBody(id.value, data.value.sub, { planRevisionId: plan.id, bundleIds: planBundleIds(plan, chosenBundles.value), cadence: cad, extraBranches: n, users: requestedUsers, storageMb, ...(isInitial.value && onboarding.value ? { onboarding: true } : {}) }))
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
    placed.value = true
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
        <UFormField :label="t('vendor.customers.plan')" required><USelect :model-value="planId" :items="planItems" class="w-full" :disabled="!hydrated || quoting || busy" @update:model-value="choosePlan(String($event))" /></UFormField>
        <UFormField :label="t('vendor.customers.change.cadence')" required><USelect v-model="cadence" :items="cadenceItems" class="w-full" :disabled="!hydrated || quoting || busy || !selectedPlan" @update:model-value="resetQuote" /></UFormField>
        <fieldset v-if="optionalBundles.length" class="space-y-2" data-testid="optional-bundles">
          <legend class="text-sm font-medium">{{ t('vendor.customers.change.bundles') }}</legend>
          <p class="text-xs text-muted">{{ t('vendor.customers.change.bundlesHint') }}</p>
          <UCheckbox v-for="bundle in optionalBundles" :key="bundle.id" :model-value="chosenBundles.includes(bundle.id)" :label="bundle.name" :disabled="!hydrated || quoting || busy" @update:model-value="chosenBundles = $event === true ? [...chosenBundles, bundle.id] : chosenBundles.filter(x => x !== bundle.id); resetQuote()" />
        </fieldset>
        <div class="grid gap-4 sm:grid-cols-3">
          <UFormField :label="t('vendor.customers.change.extraBranches')"><UInput v-model="extra" dir="ltr" inputmode="numeric" class="w-full" :disabled="!hydrated || quoting || busy" @update:model-value="resetQuote" /></UFormField>
          <UFormField :label="t('vendor.customers.change.paidUsers')" :help="selectedPlan ? t('vendor.customers.change.included', { count: selectedPlan.included_users }) : undefined"><UInput v-model="paidUsers" dir="ltr" inputmode="numeric" class="w-full" :disabled="!hydrated || quoting || busy" data-testid="paid-users" @update:model-value="resetQuote" /></UFormField>
          <UFormField :label="t('vendor.customers.change.paidStorage')" :help="selectedPlan ? t('vendor.customers.change.includedStorage', { count: selectedPlan.included_storage_mb / 1024 }) : undefined"><UInput v-model="paidStorage" dir="ltr" inputmode="numeric" class="w-full" :disabled="!hydrated || quoting || busy" data-testid="paid-storage" @update:model-value="resetQuote" /></UFormField>
        </div>
        <!-- The assisted onboarding is an optional one-time line on a first invoice, never on a change or a renewal. -->
        <UCheckbox v-if="isInitial" v-model="onboarding" :label="t('vendor.customers.newPage.onboarding')" :help="t('vendor.customers.newPage.onboardingHint')" :disabled="!hydrated || quoting || busy" data-testid="onboarding-choice" @update:model-value="resetQuote" />
        <div><UButton color="neutral" variant="outline" :loading="quoting" :disabled="!hydrated || quoting || busy || !ready" @click="recompute">{{ t('vendor.customers.change.quote') }}</UButton></div>
        <SharedCommercePriceBreakdown :quote="quote" :pending="quoting" :error="failure" @retry="recompute" />
        <div class="flex justify-end"><UButton type="submit" :loading="busy" :disabled="!hydrated || busy || quoting || !quote">{{ t('vendor.customers.change.place') }}</UButton></div>
      </form>
    </SharedPageState>
  </SharedPageContainer>
  <SharedUnsavedChanges :dirty="dirty" />
</template>
