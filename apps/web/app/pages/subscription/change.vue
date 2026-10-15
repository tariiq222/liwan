<script setup lang="ts">
import type { Quote } from '@nasq/commercial-contracts'
import { QUOTE_IS_EXPIRED, safeIdemAction } from '@/utils/subscription'
import { safePaymentRedirect } from '@/utils/subscription'
import { useCustomerCapabilities, useSubscriptionApi } from '@/composables/useSubscription'
const { t } = useI18n(); const api = useSubscriptionApi(); const { can } = useCustomerCapabilities(); const hydrated = useHydrated()
const allowed = computed(() => can('subscription.manage'))
const { data, error, pending, refresh } = await useAsyncData('subscription:change', async () => ({ sub: await api.subscription(), catalog: await api.catalog() }), { immediate: allowed.value })
const planId = ref(''); const bundleIds = ref<string[]>([]); const cadenceKey = ref('month:1'); const extra = ref(0)
const quote = ref<Quote | null>(null); const busy = ref(false); const notice = ref<'expired' | 'conflict' | 'failed' | null>(null); const redirecting = ref(false)
const dirty = computed(() => !redirecting.value && Boolean(planId.value))
const plans = computed(() => data.value?.catalog.plans ?? [])
const bundles = computed(() => data.value?.catalog.bundles ?? [])
const cadences = computed(() => { const p = plans.value.find(x => x.id === planId.value); return (p?.prices ?? [{ cadence: { unit: 'month', count: 1 } }]).map((x: any) => x.cadence) })
const cadence = computed(() => { const [unit, count] = cadenceKey.value.split(':'); return { unit: unit as 'month' | 'year', count: Number(count) } })
const body = computed(() => data.value ? ({
  kind: data.value.sub.applied ? 'change' : 'new', plan_revision_id: planId.value, bundle_revision_ids: bundleIds.value, cadence: cadence.value,
  requested_extra_branches: extra.value, subscription_id: data.value.sub.id, expected_subscription_revision: data.value.sub.revision,
}) : null)
// Any edit invalidates the shown quote; the server price is never reused for different inputs.
watch([planId, bundleIds, cadenceKey, extra], () => { quote.value = null; notice.value = null }, { deep: true })
async function review() {
  if (busy.value || !planId.value || !body.value) return
  busy.value = true; notice.value = null
  try { quote.value = await api.quote(body.value) } catch (c: any) { notice.value = c?.statusCode === 409 ? 'conflict' : 'failed' } finally { busy.value = false }
}
const action = computed(() => safeIdemAction('change', data.value?.sub.id ?? '', data.value?.sub.revision ?? 0, JSON.stringify(body.value)))
async function accept() {
  const q = quote.value
  if (busy.value || !q || !data.value) return
  if (QUOTE_IS_EXPIRED(q)) { quote.value = null; notice.value = 'expired'; return }
  busy.value = true; notice.value = null
  try {
    const { order } = await api.accept(action.value, { quote_id: q.id, expected_subscription_revision: data.value.sub.revision })
    redirecting.value = true
    if (order.payment_state === 'awaiting_payment') {
      const attempt = await api.payment(order.id, action.value)
      const url = safePaymentRedirect(attempt.redirect_url, window.location.origin)
      if (url) { window.location.assign(url); return }
    }
    api.done(action.value)
    await navigateTo({ path: '/subscription/status', query: { order: order.id } })
  } catch (c: any) {
    redirecting.value = false
    if (c?.statusCode === 409) { quote.value = null; notice.value = 'conflict'; api.done(action.value) } else notice.value = 'failed'
  } finally { busy.value = false }
}
definePageMeta({ middleware: 'customer-commercial' })
</script>
<template>
  <SharedSettingsPage width="form">
    <SharedPageHeader :title="t('subscription.change.title')" :description="t('subscription.change.description')" back-to="/subscription" />
    <SharedForbiddenState v-if="!allowed" />
    <SharedPageState v-else :loading="pending" :error="error" :empty="!pending && !error && !plans.length" :empty-text="t('subscription.change.empty')" @retry="refresh">
      <form class="space-y-6" @submit.prevent="review">
        <UFormField :label="t('subscription.change.plan')"><USelect v-model="planId" :items="plans.map(p => ({ value: p.id, label: p.name }))" :placeholder="t('subscription.change.pickPlan')" :disabled="!hydrated" class="w-full" /></UFormField>
        <fieldset v-if="bundles.length" class="space-y-2"><legend class="text-sm font-medium">{{ t('subscription.change.bundles') }}</legend>
          <UCheckbox v-for="b in bundles" :key="b.id" :model-value="bundleIds.includes(b.id)" :label="b.name" :disabled="!hydrated" @update:model-value="v => bundleIds = v ? [...bundleIds, b.id] : bundleIds.filter(x => x !== b.id)" />
        </fieldset>
        <UFormField :label="t('subscription.change.cadence')"><USelect v-model="cadenceKey" :items="cadences.map((c: any) => ({ value: `${c.unit}:${c.count}`, label: c.count === 1 ? t(`subscription.cadence.${c.unit}.one`) : t(`subscription.cadence.${c.unit}.many`, { count: c.count }) }))" :disabled="!hydrated" class="w-full" /></UFormField>
        <UFormField :label="t('subscription.change.branches')"><UInputNumber v-model="extra" :min="0" :disabled="!hydrated" /></UFormField>
        <UAlert v-if="notice" role="alert" :color="notice === 'failed' ? 'error' : 'warning'" variant="subtle" :title="t(`subscription.change.${notice}`)"><template v-if="notice !== 'failed'" #actions><UButton size="sm" color="neutral" variant="outline" :disabled="busy" @click="review">{{ t('subscription.change.requote') }}</UButton></template></UAlert>
        <SharedCommercePriceBreakdown :quote="quote" :pending="busy" />
        <p v-if="redirecting" role="status" class="text-sm text-muted">{{ t('subscription.change.redirecting') }}</p>
        <div class="flex gap-2">
          <UButton type="submit" :disabled="!hydrated || busy || !planId" :loading="busy && !quote">{{ t('subscription.change.review') }}</UButton>
          <UButton v-if="quote" type="button" :disabled="busy || redirecting" :loading="busy" @click="accept">{{ t('subscription.change.accept') }}</UButton>
        </div>
      </form>
      <SharedUnsavedChanges :dirty="dirty" />
    </SharedPageState>
  </SharedSettingsPage>
</template>
