<script setup lang="ts">
import type { Quote } from '@webvue/commercial-contracts'
import { cadenceLabel, formatCommercialMoney } from '@webvue/commercial-ui/app/utils/commercial'
import { QUOTE_IS_EXPIRED, safeIdemAction, safePaymentRedirect } from '@/utils/subscription'
import { useCustomerCapabilities, useSubscriptionApi } from '@/composables/useSubscription'
const { t, locale } = useI18n(); const api = useSubscriptionApi(); const { can } = useCustomerCapabilities(); const hydrated = useHydrated()
const allowed = computed(() => can('subscription.manage'))
const { data, error, pending, refresh } = await useAsyncData('subscription:change', async () => ({ sub: await api.subscription(), catalog: await api.catalog() }), { immediate: allowed.value })
const plans = computed<Array<Record<string, any>>>(() => data.value?.catalog.plans ?? [])
const bundles = computed(() => data.value?.catalog.bundles ?? [])
const planId = ref(''); const bundleIds = ref<string[]>([]); const cadenceKey = ref(''); const users = ref(1); const storageGb = ref(0); const extra = ref(0)
const quote = ref<Quote | null>(null); const previewPending = ref(false); const previewError = ref('')
const notice = ref<'expired' | 'conflict' | 'changed' | 'failed' | null>(null); const busy = ref(false); const redirecting = ref(false)
const plan = computed(() => plans.value.find((p: Record<string, any>) => p.id === planId.value) ?? null)
const includedIds = computed(() => new Set(plan.value?.included_bundle_revision_ids ?? []))
const selectableBundles = computed(() => bundles.value.filter(b => !includedIds.value.has(b.id)))
const keyOf = (c: { unit: string; count: number }) => `${c.unit}:${c.count}`
const cadence = computed(() => { const [unit, count] = cadenceKey.value.split(':'); return { unit: unit as 'month' | 'year', count: Number(count) } })
const cadenceOptions = computed(() => (plan.value?.prices ?? []).map((p: { cadence: { unit: 'month' | 'year'; count: number }; amount: Quote['due_now'] }) => ({ value: keyOf(p.cadence), label: `${cadenceLabel(p.cadence, t)} · ${formatCommercialMoney(p.amount, locale.value)}` })))
const priceFor = (rows: Array<{ cadence: { unit: string; count: number; }; amount: Quote['due_now'] }> | undefined) => rows?.find(p => keyOf(p.cadence) === cadenceKey.value)
const money = (m: Quote['due_now']) => formatCommercialMoney(m, locale.value)
const userUnit = computed(() => priceFor(plan.value?.user_prices))
const storageUnit = computed(() => priceFor(plan.value?.storage_prices))
const minUsers = computed(() => Math.max(1, plan.value?.included_users ?? 1))
const minStorageGb = computed(() => Math.ceil((plan.value?.included_storage_mb ?? 0) / 1024))
const minBranches = computed(() => plan.value?.included_extra_branches ?? 0)
const bundlePrice = (b: (typeof bundles.value)[number]) => priceFor(b.prices)
const bundleLabel = (b: (typeof bundles.value)[number]) => {
  const price = bundlePrice(b)
  return price ? `${b.name} · ${money(price.amount)}` : `${b.name} · ${t('subscription.change.unavailable')}`
}
const body = computed(() => {
  const s = data.value?.sub; const p = plan.value
  if (!s || !p || !cadenceKey.value) return null
  return {
    kind: s.applied ? 'change' as const : 'new' as const, plan_revision_id: p.id, bundle_revision_ids: bundleIds.value,
    cadence: cadence.value, requested_extra_branches: extra.value, requested_users: users.value,
    requested_storage_mb: storageGb.value * 1024, subscription_id: s.id, expected_subscription_revision: s.revision,
  }
})
const baseline = ref('')
watch(body, value => { if (!baseline.value && value) baseline.value = JSON.stringify(value) }, { immediate: true })
const dirty = computed(() => !redirecting.value && Boolean(baseline.value) && JSON.stringify(body.value) !== baseline.value)
watch(data, d => {
  if (!d || planId.value) return
  const applied = d.sub.applied
  planId.value = applied?.plan_revision_id ?? d.catalog.plans[0]?.id ?? ''
  if (applied) {
    cadenceKey.value = keyOf(applied.cadence); bundleIds.value = [...applied.bundle_revision_ids]
    users.value = Number(applied.entitlement.features['users.limit'] ?? 1)
    storageGb.value = Number(applied.entitlement.features['storage.limit_mb'] ?? 0) / 1024
    extra.value = applied.extra_branch_count
  } else if (d.catalog.plans[0]?.prices[0]) cadenceKey.value = keyOf(d.catalog.plans[0].prices[0].cadence)
}, { immediate: true })
watch(planId, () => {
  const p = plan.value
  if (!p) return
  if (!p.prices.some((x: { cadence: { unit: string; count: number } }) => keyOf(x.cadence) === cadenceKey.value) && p.prices[0]) cadenceKey.value = keyOf(p.prices[0].cadence)
  users.value = Math.max(users.value, minUsers.value)
  storageGb.value = Math.max(storageGb.value, minStorageGb.value)
  extra.value = Math.max(extra.value, minBranches.value)
})
// Live server quote: only ids and quantities are sent; every amount comes back from the control plane.
let timer: ReturnType<typeof setTimeout> | undefined; let seq = 0
async function runPreview() {
  const value = body.value
  if (!value || !hydrated.value) return
  const mine = ++seq
  previewPending.value = true; previewError.value = ''
  try { const result = await api.preview(value); if (mine === seq) quote.value = result }
  catch { if (mine === seq) { quote.value = null; previewError.value = t('subscription.change.previewFailed') } }
  finally { if (mine === seq) previewPending.value = false }
}
function schedule() {
  quote.value = null; notice.value = null
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void runPreview(), 350)
}
watch([planId, bundleIds, cadenceKey, users, storageGb, extra], schedule, { deep: true })
onMounted(() => void runPreview()); onBeforeUnmount(() => { if (timer) clearTimeout(timer) })
function retryPreview() { notice.value = null; void runPreview() }
async function accept() {
  const value = body.value; const sub = data.value?.sub
  if (!hydrated.value || busy.value || !value || !sub) return
  if (quote.value && QUOTE_IS_EXPIRED(quote.value)) { notice.value = 'expired'; void runPreview(); return }
  busy.value = true; notice.value = null
  try {
    // Persist the accepted quote now, not on every keystroke, and refuse a silent price change.
    const fresh = await api.quote(value)
    if (quote.value && (fresh.due_now.minor !== quote.value.due_now.minor || fresh.digest !== quote.value.digest)) {
      quote.value = fresh; notice.value = 'changed'; return
    }
    const action = safeIdemAction('change', sub.id, sub.revision, JSON.stringify(value))
    const { order } = await api.accept(action, { quote_id: fresh.id, expected_subscription_revision: sub.revision })
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
    if (cause?.statusCode === 409) { notice.value = 'conflict'; void runPreview() } else notice.value = 'failed'
  } finally { busy.value = false }
}
const noticeKey = computed(() => (notice.value ? `subscription.change.${notice.value}` : ''))
definePageMeta({ middleware: 'customer-commercial' })
</script>
<template>
  <SharedSettingsPage width="detail">
    <SharedPageHeader :title="t('subscription.change.title')" back-to="/subscription" />
    <SharedForbiddenState v-if="!allowed" />
    <SharedPageState v-else :loading="pending" :error="error" :empty="!pending && !error && !plans.length" :empty-text="t('subscription.change.empty')" @retry="refresh">
      <form class="grid items-start gap-(--webvue-gap-card) lg:grid-cols-[minmax(0,1fr)_22rem]" @submit.prevent="accept">
        <div class="grid gap-(--webvue-gap-card)">
          <SharedFormSection panel :title="t('subscription.change.plan')">
            <div class="space-y-5">
              <UFormField :label="t('subscription.change.plan')"><USelect v-model="planId" :items="plans.map(p => ({ value: p.id, label: p.name }))" :disabled="!hydrated" class="w-full" /></UFormField>
              <UFormField :label="t('subscription.change.cadence')"><USelect v-model="cadenceKey" :items="cadenceOptions" :disabled="!hydrated" class="w-full" /></UFormField>
            </div>
          </SharedFormSection>
          <SharedFormSection panel :title="t('subscription.change.applications')">
            <p v-if="!selectableBundles.length" class="text-sm text-muted">{{ t('subscription.change.empty') }}</p>
            <div v-else class="space-y-3">
              <UCheckbox v-for="b in selectableBundles" :key="b.id" :model-value="bundleIds.includes(b.id)" :label="bundleLabel(b)" :disabled="!hydrated" @update:model-value="v => bundleIds = v ? [...bundleIds, b.id] : bundleIds.filter(x => x !== b.id)" />
            </div>
          </SharedFormSection>
          <SharedFormSection panel :title="t('subscription.change.quantities')">
            <div class="grid gap-5 sm:grid-cols-3">
              <UFormField :label="t('subscription.change.users')" :help="`${t('subscription.change.included', { count: minUsers })} · ${t('subscription.change.perUser', { price: userUnit ? money(userUnit.amount) : '—' })}`">
                <UInputNumber v-model="users" :min="minUsers" :disabled="!hydrated" class="w-full" />
              </UFormField>
              <UFormField :label="t('subscription.change.storage')" :help="`${t('subscription.change.included', { count: minStorageGb })} · ${t('subscription.change.perStorage', { price: storageUnit ? money(storageUnit.amount) : '—' })}`">
                <UInputNumber v-model="storageGb" :min="minStorageGb" :disabled="!hydrated" class="w-full" />
              </UFormField>
              <UFormField :label="t('subscription.change.branches')" :help="t('subscription.change.includedBranches', { count: minBranches })">
                <UInputNumber v-model="extra" :min="minBranches" :disabled="!hydrated" class="w-full" />
              </UFormField>
            </div>
          </SharedFormSection>
        </div>
        <aside class="grid gap-4 self-start lg:sticky lg:top-6">
          <SharedRecordSection variant="panel" :title="t('subscription.change.liveTotal')" :description="t('subscription.change.liveHint')">
            <SharedCommercePriceBreakdown :quote="quote" :pending="previewPending" :error="previewError" @retry="retryPreview" />
          </SharedRecordSection>
          <UAlert v-if="notice" role="alert" :color="notice === 'failed' ? 'error' : 'warning'" variant="subtle" :title="t(noticeKey)">
            <template v-if="notice !== 'failed'" #actions><UButton size="sm" color="neutral" variant="outline" :disabled="busy" @click="retryPreview">{{ t('subscription.change.requote') }}</UButton></template>
          </UAlert>
          <p v-if="redirecting" role="status" class="text-sm text-muted">{{ t('subscription.change.redirecting') }}</p>
          <SharedFormActions>
            <UButton type="submit" :disabled="!hydrated || busy || redirecting || !quote || previewPending" :loading="busy">{{ t('subscription.change.continue') }}</UButton>
          </SharedFormActions>
        </aside>
      </form>
      <SharedUnsavedChanges :dirty="dirty" />
    </SharedPageState>
  </SharedSettingsPage>
</template>
