<script setup lang="ts">
import type { Quote } from '@liwan/commercial-contracts'
import { cadenceLabel, formatCommercialMoney } from '@liwan/commercial-ui/app/utils/commercial'
import { nearestStorageOption, QUOTE_IS_EXPIRED, refusalCode, refusalKey, safeIdemAction, safePaymentRedirect, sameQuoteEconomics, storageOptions, STORAGE_MB_PER_GB } from '@/utils/subscription'
import { useCustomerCapabilities, useSubscriptionApi } from '@/composables/useSubscription'
const { t, locale } = useI18n(); const api = useSubscriptionApi(); const { can } = useCustomerCapabilities(); const hydrated = useHydrated()
const allowed = computed(() => can('subscription.manage'))
const isMissing = (cause: any) => (cause?.statusCode ?? cause?.status ?? cause?.response?.status) === 404
const { data, error, pending, refresh } = await useAsyncData('subscription:change', async () => {
  const catalog = await api.catalog()
  // A customer without a subscription yet is exactly the trial candidate: absence is a state, not a page error.
  const sub = await api.subscription().catch((cause: any) => { if (isMissing(cause)) return null; throw cause })
  return { sub, catalog }
}, { immediate: allowed.value })
const plans = computed<Array<Record<string, any>>>(() => data.value?.catalog.plans ?? [])
const bundles = computed(() => data.value?.catalog.bundles ?? [])
const planId = ref(''); const bundleIds = ref<string[]>([]); const cadenceKey = ref(''); const users = ref(1); const storageMb = ref(0); const extra = ref(0)
const quote = ref<Quote | null>(null); const previewPending = ref(false); const previewError = ref('')
const notice = ref<'expired' | 'conflict' | 'changed' | 'failed' | 'start' | 'refused' | null>(null); const refusal = ref<string | null>(null); const busy = ref(false); const redirecting = ref(false)
const plan = computed(() => plans.value.find((p: Record<string, any>) => p.id === planId.value) ?? null)
const includedIds = computed(() => new Set(plan.value?.included_bundle_revision_ids ?? []))
// The plan's optional revisions are the application menu; an existing subscription keeps the
// bundles it already bought even if the current plan revision narrowed the menu.
const appliedBundleIds = computed(() => new Set(data.value?.sub?.applied?.bundle_revision_ids ?? []))
const allowedBundleIds = computed(() => new Set([...(plan.value?.optional_bundle_revision_ids ?? []), ...(plan.value?.included_bundle_revision_ids ?? []), ...appliedBundleIds.value]))
const selectableBundles = computed(() => bundles.value.filter(b => allowedBundleIds.value.has(b.id) && !includedIds.value.has(b.id)))
const keyOf = (c: { unit: string; count: number }) => `${c.unit}:${c.count}`
const cadence = computed(() => { const [unit, count] = cadenceKey.value.split(':'); return { unit: unit as 'month' | 'year', count: Number(count) } })
const fullyPriced = computed(() => new Set((plan.value?.prices ?? []).filter((p: { cadence: { unit: string; count: number } }) => priceFor(plan.value?.user_prices, keyOf(p.cadence)) && priceFor(plan.value?.storage_prices, keyOf(p.cadence))).map((p: { cadence: { unit: string; count: number } }) => keyOf(p.cadence))))
const cadenceOptions = computed(() => (plan.value?.prices ?? []).filter((p: { cadence: { unit: string; count: number } }) => fullyPriced.value.has(keyOf(p.cadence))).map((p: { cadence: { unit: 'month' | 'year'; count: number }; amount: Quote['due_now'] }) => ({ value: keyOf(p.cadence), label: `${cadenceLabel(p.cadence, t)} · ${formatCommercialMoney(p.amount, locale.value)}` })))
const priceFor = (rows: Array<{ cadence: { unit: string; count: number; }; amount: Quote['due_now'] }> | undefined, key = cadenceKey.value) => rows?.find(p => keyOf(p.cadence) === key)
const money = (m: Quote['due_now']) => formatCommercialMoney(m, locale.value)
const userUnit = computed(() => priceFor(plan.value?.user_prices))
const minUsers = computed(() => Math.max(1, plan.value?.included_users ?? 1))
// Release 1 sells at most MAX_USERS users per company; the server refuses the quote above it (users_limit_exceeded).
const MAX_USERS = 100
const usersOverCap = computed(() => users.value > MAX_USERS)
const minBranches = computed(() => plan.value?.included_extra_branches ?? 0)
// Storage is bought in the plan's steps (see storageOptions): the select offers the legal totals only, and each row
// carries the price of the extra it adds, never a price this page invented.
const storageChoices = computed(() => storageOptions(plan.value ?? {}, plan.value?.storage_prices, cadence.value))
const storageChoice = computed(() => storageChoices.value.find(o => o.storageMb === storageMb.value) ?? null)
// Every row is a plan total in GiB; the extra it adds is priced, and the included amount says so instead of "0.00".
const storageLabel = (o: (typeof storageChoices.value)[number]) => `${o.totalGb} ${t('subscription.change.gib')} · ${!o.extraMb ? t('subscription.change.storageIncluded') : o.amount ? money(o.amount) : t('subscription.change.unavailable')}`
const storageHelp = computed(() => !storageChoice.value?.amount ? t('subscription.change.unavailable') : storageChoice.value.extraMb ? t('subscription.change.perStorage', { price: money(storageChoice.value.amount) }) : t('subscription.change.perStorageNone'))
const bundlePrice = (b: (typeof bundles.value)[number]) => priceFor(b.prices)
const bundleSelectable = (b: (typeof bundles.value)[number]) => Boolean(bundlePrice(b))
const bundleLabel = (b: (typeof bundles.value)[number]) => {
  const price = bundlePrice(b)
  return price ? `${b.name} · ${money(price.amount)}` : `${b.name} · ${t('subscription.change.unavailable')}`
}
const planTrialDays = computed(() => Number(plan.value?.trial_days ?? 0))
const trialAvailable = computed(() => Boolean(!data.value?.sub?.applied && planTrialDays.value > 0))
// A9: the assisted onboarding is an optional one-time item on the customer's FIRST order only, never on a change.
const onboarding = ref(false)
const firstOrder = computed(() => !data.value?.sub?.applied)
const body = computed(() => {
  const s = data.value?.sub; const p = plan.value
  if (!p || !cadenceKey.value) return null
  return {
    kind: s?.applied ? 'change' as const : 'new' as const, plan_revision_id: p.id, bundle_revision_ids: bundleIds.value,
    cadence: cadence.value, requested_extra_branches: extra.value, requested_users: users.value,
    requested_storage_mb: storageMb.value, subscription_id: s?.id ?? null, expected_subscription_revision: s?.revision ?? 0,
    ...(firstOrder.value && onboarding.value ? { onboarding: true } : {}),
  }
})
const baseline = ref('')
const dirty = computed(() => !redirecting.value && Boolean(baseline.value) && JSON.stringify(body.value) !== baseline.value)
watch(data, d => {
  if (!d || planId.value) return
  const applied = d.sub?.applied
  // A withdrawn revision stays pinned for the customer but cannot be re-quoted: start from the sellable catalog.
  planId.value = applied && d.catalog.plans.some((p: Record<string, any>) => p.id === applied.plan_revision_id) ? applied.plan_revision_id : d.catalog.plans[0]?.id ?? ''
  if (applied) {
    cadenceKey.value = keyOf(applied.cadence)
    users.value = Number(applied.entitlement.features['users.limit'] ?? 1)
    storageMb.value = Number(applied.entitlement.features['storage.limit_mb'] ?? 0)
    extra.value = applied.extra_branch_count
    nextTick(() => { bundleIds.value = applied.bundle_revision_ids.filter(id => allowedBundleIds.value.has(id) && !includedIds.value.has(id)) })
  }
  nextTick(() => { baseline.value = body.value ? JSON.stringify(body.value) : '' })
}, { immediate: true })
watch(planId, () => {
  const p = plan.value
  if (!p) return
  // Only cadences with complete unit prices are offered; a missing one is unavailable, never zero.
  if (!cadenceOptions.value.some((o: { value: string }) => o.value === cadenceKey.value)) cadenceKey.value = cadenceOptions.value[0]?.value ?? ''
  users.value = Math.max(users.value, minUsers.value)
  storageMb.value = nearestStorageOption(storageChoices.value, storageMb.value)?.storageMb ?? 0
  extra.value = Math.max(extra.value, minBranches.value)
  bundleIds.value = bundleIds.value.filter(id => allowedBundleIds.value.has(id) && !includedIds.value.has(id))
})
// The storage options depend on the plan and the cadence: a different plan or cycle must not keep a quantity it does not sell.
watch(storageChoices, (options) => {
  if (!options.length) return
  storageMb.value = nearestStorageOption(options, storageMb.value)?.storageMb ?? 0
})
// Live server quote: only ids and quantities are sent; every amount comes back from the control plane.
let timer: ReturnType<typeof setTimeout> | undefined; let seq = 0
async function runPreview() {
  const value = body.value
  if (!value || !hydrated.value) return
  if (usersOverCap.value) { quote.value = null; previewError.value = t('subscription.change.usersCapNote'); return }
  const { subscription_id: _subscription, ...previewBody } = value
  const mine = ++seq
  previewPending.value = true; previewError.value = ''
  try { const result = await api.preview(previewBody); if (mine === seq) quote.value = result }
  catch (cause: unknown) {
    if (mine !== seq) return
    quote.value = null
    // A refused storage quantity gets its own explanation; every other cause keeps the generic preview failure.
    const key = refusalKey(refusalCode(cause))
    previewError.value = key ? t(key) : t('subscription.change.previewFailed')
  }
  finally { if (mine === seq) previewPending.value = false }
}
function schedule() {
  quote.value = null; notice.value = null
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void runPreview(), 350)
}
watch(cadenceKey, () => { bundleIds.value = bundleIds.value.filter(id => { const b = bundles.value.find(x => x.id === id); return Boolean(b && bundlePrice(b)) }) })
watch([planId, bundleIds, cadenceKey, users, storageMb, extra], schedule, { deep: true })
onMounted(() => void runPreview()); onBeforeUnmount(() => { if (timer) clearTimeout(timer) })
function retryPreview() { notice.value = null; void runPreview() }
async function startTrial() {
  const value = body.value
  if (!hydrated.value || busy.value || !value || !data.value || usersOverCap.value) return
  busy.value = true; notice.value = null
  try {
    const { subscription_id: _subscription, ...trialBody } = value
    const result = await api.startTrial(trialBody)
    api.done(safeIdemAction('change', data.value?.sub?.id ?? '', data.value?.sub?.revision ?? 0, JSON.stringify(value)))
    await navigateTo({ path: '/subscription/status', query: { order: result.order.id } })
  } catch (cause: any) {
    const key = refusalKey(refusalCode(cause))
    notice.value = key ? 'refused' : 'start'
    refusal.value = key
  } finally { busy.value = false }
}
async function accept() {
  const value = body.value; const sub = data.value?.sub
  if (!hydrated.value || busy.value || !value || usersOverCap.value) return
  if (quote.value && QUOTE_IS_EXPIRED(quote.value)) { notice.value = 'expired'; void runPreview(); return }
  busy.value = true; notice.value = null
  try {
    // Persist the accepted quote now, not on every keystroke, and refuse a silent price change.
    const fresh = await api.quote(value)
    if (quote.value && !sameQuoteEconomics(fresh, quote.value)) {
      quote.value = fresh; notice.value = 'changed'; return
    }
    const action = safeIdemAction('change', sub?.id ?? '', sub?.revision ?? 0, JSON.stringify(value))
    const { order } = await api.accept(action, { quote_id: fresh.id, expected_subscription_revision: sub?.revision ?? 0 })
    redirecting.value = true
    if (order.payment_state === 'awaiting_payment') {
      const attempt = await api.payment(order.id, action)
      const url = safePaymentRedirect(attempt.redirect_url, window.location.origin)
      if (url) { window.location.assign(url); return }
    }
    api.done(action)
    await navigateTo({ path: '/subscription/status', query: { order: order.id } })
  } catch (cause: any) {
    redirecting.value = false
    const key = refusalKey(refusalCode(cause))
    if (key) { refusal.value = key; notice.value = 'refused' }
    else if (cause?.statusCode === 409) { notice.value = 'conflict'; void runPreview() }
    else notice.value = 'failed'
  } finally { busy.value = false }
}
const noticeKey = computed(() => notice.value === 'start' ? 'subscription.trial.startFailed' : notice.value === 'refused' ? (refusal.value ?? 'subscription.trial.startFailed') : notice.value ? `subscription.change.${notice.value}` : '')
definePageMeta({ middleware: 'customer-commercial' })
</script>
<template>
  <SharedSettingsPage>
    <SharedPageHeader :title="t('subscription.change.title')" back-to="/subscription" />
    <SharedForbiddenState v-if="!allowed" />
    <SharedPageState v-else :loading="pending" :error="error" :empty="!pending && !error && !plans.length" :empty-text="t('subscription.change.empty')" @retry="refresh">
      <form class="grid items-start gap-(--liwan-gap-card) lg:grid-cols-[minmax(0,1fr)_22rem]" @submit.prevent="accept">
        <div class="grid gap-(--liwan-gap-card)">
          <SharedFormSection panel :title="t('subscription.change.plan')">
            <div class="space-y-5">
              <UFormField :label="t('subscription.change.plan')"><USelect v-model="planId" :items="plans.map(p => ({ value: p.id, label: p.name }))" :disabled="!hydrated" class="w-full" /></UFormField>
              <UFormField :label="t('subscription.change.cadence')"><USelect v-model="cadenceKey" :items="cadenceOptions" :disabled="!hydrated" class="w-full" /></UFormField>
            </div>
          </SharedFormSection>
          <SharedFormSection panel :title="t('subscription.change.applications')">
            <p v-if="!selectableBundles.length" class="text-sm text-muted">{{ t('subscription.change.empty') }}</p>
            <div v-else class="space-y-3">
              <UCheckbox v-for="b in selectableBundles" :key="b.id" :model-value="bundleIds.includes(b.id)" :label="bundleLabel(b)" :disabled="!hydrated || !bundleSelectable(b)" @update:model-value="v => bundleIds = v ? [...bundleIds, b.id] : bundleIds.filter(x => x !== b.id)" />
            </div>
          </SharedFormSection>
          <SharedFormSection panel :title="t('subscription.change.quantities')">
            <div class="liwan-auto-grid gap-5">
              <UFormField :label="t('subscription.change.users')" :help="`${t('subscription.change.included', { count: minUsers })} · ${t('subscription.change.perUser', { price: userUnit ? money(userUnit.amount) : '—' })}`">
                <UInputNumber v-model="users" :min="minUsers" :max="100" :disabled="!hydrated" class="w-full" />
                <p class="mt-1 text-sm" :class="usersOverCap ? 'text-error' : 'text-muted'">{{ t('subscription.change.usersCapNote') }}</p>
              </UFormField>
              <UFormField :label="t('subscription.change.storage')" :help="storageHelp">
                <USelect v-model="storageMb" :items="storageChoices.map(o => ({ value: o.storageMb, label: storageLabel(o) }))" :disabled="!hydrated || !storageChoices.length" class="w-full" />
              </UFormField>
              <UFormField :label="t('subscription.change.branches')" :help="t('subscription.change.includedBranches', { count: minBranches })">
                <UInputNumber v-model="extra" :min="minBranches" :disabled="!hydrated" class="w-full" />
              </UFormField>
            </div>
          </SharedFormSection>
          <!-- A9: offered on the customer's first order only; it never appears on a change or a renewal. -->
          <SharedFormSection v-if="firstOrder" panel :title="t('subscription.change.onboarding')">
            <UCheckbox v-model="onboarding" :label="t('subscription.change.onboardingChoice')" :help="t('subscription.change.onboardingHint')" :disabled="!hydrated" data-testid="onboarding-choice" />
          </SharedFormSection>
        </div>
        <aside class="grid gap-4 self-start lg:sticky lg:top-6">
          <SharedRecordSection variant="panel" :title="t('subscription.change.liveTotal')" :description="t('subscription.change.liveHint')">
            <SharedCommercePriceBreakdown :quote="quote" :pending="previewPending" :error="previewError" @retry="retryPreview" />
          </SharedRecordSection>
          <UAlert v-if="notice" role="alert" :color="notice === 'failed' || notice === 'refused' ? 'error' : 'warning'" variant="subtle" :title="t(noticeKey)">
            <template v-if="notice !== 'failed'" #actions><UButton size="sm" color="neutral" variant="outline" :disabled="busy" @click="retryPreview">{{ t('subscription.change.requote') }}</UButton></template>
          </UAlert>
          <p v-if="redirecting" role="status" class="text-sm text-muted">{{ t('subscription.change.redirecting') }}</p>
          <SharedFormActions>
            <UButton type="submit" :disabled="!hydrated || busy || redirecting || !quote || previewPending || usersOverCap" :loading="busy">{{ t('subscription.change.continue') }}</UButton>
            <UButton v-if="trialAvailable" type="button" color="neutral" variant="outline" :disabled="!hydrated || busy || redirecting || !quote || previewPending || usersOverCap" @click="startTrial">{{ t('subscription.trial.start', { count: planTrialDays }) }}</UButton>
          </SharedFormActions>
        </aside>
      </form>
      <SharedUnsavedChanges :dirty="dirty" />
    </SharedPageState>
  </SharedSettingsPage>
</template>
