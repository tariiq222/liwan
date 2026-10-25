<script setup lang="ts">
import { subscriptionStateBadge } from '@/utils/subscription'
import { daysBetween, riyadhDate, subscriptionDisplayState } from '@webvue/commercial-contracts'
import { formatSubscriptionMoney, safePaymentRedirect } from '@/utils/subscription'
import { entitledFeaturePrefixes } from '@webvue/commercial-ui/app/utils/entitlementApps'
import { humanizeId } from '@webvue/ui/app/utils/humanizeId'
import { useCustomerCapabilities, useSubscriptionApi } from '@/composables/useSubscription'
const { t, te, locale } = useI18n(); const api = useSubscriptionApi(); const { can } = useCustomerCapabilities(); const hydrated = useHydrated()
const allowed = computed(() => can('subscription.read'))
const isMissing = (cause: any) => (cause?.statusCode ?? cause?.status ?? cause?.response?.status) === 404
const { data, error, pending, refresh } = await useAsyncData('subscription:overview', async () => {
  const [sub, usage, branches, invoices] = await Promise.all([
    api.subscription().catch((cause: any) => { if (isMissing(cause)) return null; throw cause }),
    api.usage().catch(() => null), api.branches().catch(() => null),
    can('billing.read') ? api.invoices().catch(() => null) : Promise.resolve(null),
  ])
  return { sub, usage, branches, invoices }
}, { immediate: allowed.value })
const display = computed(() => (data.value?.sub ? subscriptionDisplayState(data.value.sub) : null))
// The one action block: only when the customer must act on an order (payment due or activation failed).
const needsAction = computed(() => display.value === 'awaiting_payment' || display.value === 'failed')
const entitlement = computed(() => data.value?.sub.applied?.entitlement ?? null)
const trialEndsAt = computed(() => data.value?.sub.trial_ends_at ?? null)
const trialDaysLeft = computed(() => trialEndsAt.value ? daysBetween(riyadhDate(new Date()), riyadhDate(new Date(trialEndsAt.value))) : null)
const converting = ref(false); const convertError = ref<string | undefined>()
async function convertTrial() {
  if (converting.value || !can('subscription.manage')) return
  converting.value = true; convertError.value = undefined
  try {
    const result = await api.convertTrial()
    const url = result.attempt?.redirect_url ? safePaymentRedirect(result.attempt.redirect_url, window.location.origin) : null
    if (url) { window.location.assign(url); return }
    if (result.order) await navigateTo({ path: '/subscription/status', query: { order: result.order.id } })
  } catch { convertError.value = t('subscription.trial.convertFailed') } finally { converting.value = false }
}
const entitledApps = computed(() => entitledFeaturePrefixes(entitlement.value?.features))
const appLabel = (app: string) => (te(`subscription.apps.${app}`) ? t(`subscription.apps.${app}`) : humanizeId(app))
const arBusy = ref(false); const arError = ref<unknown>(null)
async function setAutoRenew(enabled: boolean) {
  if (arBusy.value || !can('subscription.manage')) return
  arBusy.value = true; arError.value = null
  try { await api.setAutoRenew(enabled); await refresh() } catch (cause) { arError.value = cause } finally { arBusy.value = false }
}
definePageMeta({ middleware: 'customer-commercial' })
</script>
<template>
  <SharedSettingsPage width="detail">
    <SharedPageHeader :title="t('subscription.title')">
      <template #actions><UButton v-if="can('subscription.manage')" to="/subscription/change" icon="i-lucide-repeat" :disabled="!hydrated">{{ t('subscription.summary.change') }}</UButton></template>
    </SharedPageHeader>
    <SharedForbiddenState v-if="!allowed" />
    <SharedPageState v-else :loading="pending" :error="error" @retry="refresh">
      <div v-if="data && !data.sub" class="grid gap-(--webvue-gap-card)">
        <SharedRecordSection variant="panel" :title="t('subscription.summary.plan')">
          <p class="text-sm text-muted">{{ t('subscription.summary.none') }}</p>
          <UButton v-if="can('subscription.manage')" class="mt-3" to="/subscription/change" :disabled="!hydrated">{{ t('subscription.trial.startSetup') }}</UButton>
        </SharedRecordSection>
      </div>
      <div v-else-if="data" class="grid gap-(--webvue-gap-card)">
        <UAlert v-if="data.sub.state === 'trialing' && trialDaysLeft !== null" :color="trialDaysLeft <= 3 ? 'warning' : 'info'" variant="subtle" icon="i-lucide-hourglass"
          :title="t('subscription.trial.daysLeft', { count: trialDaysLeft })"
          :description="`${t('subscription.trial.endsOn', { date: trialEndsAt?.slice(0, 10) })}${trialDaysLeft <= 3 ? ' — ' + t('subscription.trial.expiring') : ''}`">
          <template #actions><UButton size="sm" color="neutral" variant="outline" :disabled="!hydrated || converting" :loading="converting" @click="convertTrial">{{ t('subscription.trial.convert') }}</UButton></template>
        </UAlert>
        <UAlert v-if="convertError" color="error" variant="subtle" :title="convertError" />
        <SharedRecordSection
          v-if="data.sub.pending_order || data.sub.target" :variant="needsAction ? 'action' : 'tinted'" data-testid="pending-change"
          :title="t('subscription.summary.pending')" :description="t('subscription.summary.pendingHint')"
        >
          <template v-if="data.sub.pending_order" #actions><UButton size="sm" :color="needsAction ? 'primary' : 'neutral'" :variant="needsAction ? 'solid' : 'outline'" :to="{ path: '/subscription/status', query: { order: data.sub.pending_order.id } }">{{ t('subscription.summary.viewStatus') }}</UButton></template>
        </SharedRecordSection>
        <SharedRecordSection variant="panel" :title="t('subscription.summary.plan')"><template #actions><SharedStatusBadge v-if="display" data-slot="subscription-state" :data-state="display" :tone="subscriptionStateBadge(display).tone" :label="t(subscriptionStateBadge(display).labelKey)" /></template>
          <p v-if="!data.sub.applied" class="text-sm text-muted">{{ t('subscription.summary.none') }}</p>
          <SharedPropertiesPanel v-else>
            <SharedPropertyRow :label="t('subscription.summary.cadence')" :value="data.sub.applied.cadence.count === 1 ? t(`subscription.cadence.${data.sub.applied.cadence.unit}.one`) : t(`subscription.cadence.${data.sub.applied.cadence.unit}.many`, { count: data.sub.applied.cadence.count })" />
            <SharedPropertyRow v-if="data.sub.renewal_at" :label="t('subscription.summary.renewal')"><bdi dir="ltr">{{ data.sub.renewal_at }}</bdi></SharedPropertyRow><SharedPropertyRow v-else :label="t('subscription.summary.renewal')" :value="null" />
          </SharedPropertiesPanel>
        </SharedRecordSection>
        <SharedRecordSection variant="panel" :title="t('subscription.summary.services')">
          <p v-if="!entitledApps.length" class="text-sm text-muted">{{ t('subscription.summary.noServices') }}</p>
          <ul v-else class="flex flex-wrap gap-2"><li v-for="app in entitledApps" :key="app"><SharedStatusBadge tone="neutral" variant="subtle" :label="appLabel(app)" /></li></ul>
        </SharedRecordSection>
        <SharedRecordSection :title="t('subscription.usage.title')">
          <SubscriptionUsagePanel v-if="data.usage" :usage="data.usage" />
          <p v-else class="text-sm text-muted" role="status">{{ t('subscription.usage.unavailableNote') }}</p>
        </SharedRecordSection>
        <SharedRecordSection variant="list" :title="t('subscription.branches.title')"><template #actions><UButton to="/subscription/branches" color="neutral" variant="link">{{ t('subscription.branches.title') }}</UButton></template>
          <SubscriptionBranchSummary v-if="data.branches" :summary="data.branches" />
        </SharedRecordSection>
        <SharedRecordSection v-if="data.invoices" variant="list" :title="t('subscription.invoices.preview')"><template #actions><UButton to="/subscription/invoices" color="neutral" variant="link">{{ t('subscription.invoices.all') }}</UButton></template>
          <p v-if="!data.invoices.items.length" class="p-(--webvue-card-pad) text-sm text-muted">{{ t('subscription.invoices.empty') }}</p>
          <ul v-else class="divide-y divide-default"><li v-for="inv in data.invoices.items.slice(0, 3)" :key="inv.id" class="flex items-center justify-between gap-3 px-(--webvue-card-pad) py-3"><NuxtLink :to="`/subscription/invoices/${encodeURIComponent(inv.id)}`" class="font-medium hover:underline">{{ inv.number ?? inv.id }}</NuxtLink><span class="tabular-nums">{{ formatSubscriptionMoney(inv.total, locale) }}</span></li></ul>
        </SharedRecordSection>
        <SharedRecordSection variant="panel" :title="t('subscription.autoRenew.title')">
          <SubscriptionAutoRenewControl :enabled="data.sub.auto_renew.enabled" :can-manage="can('subscription.manage')" :pending="arBusy" :hydrated="hydrated" @change="setAutoRenew" />
          <UAlert v-if="arError" class="mt-3" color="error" variant="subtle" :title="t('errors.generic')" />
        </SharedRecordSection>
      </div>
    </SharedPageState>
  </SharedSettingsPage>
</template>
