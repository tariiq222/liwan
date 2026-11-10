<script setup lang="ts">
import { subscriptionStateBadge } from '@/utils/subscription'
import { subscriptionDisplayState } from '@liwan/commercial-contracts'
import { formatDate, formatDateTime } from '@liwan/ui/app/utils/formatDate'
import { formatSubscriptionMoney, orderOutcome, refusalCode, refusalKey, safePaymentRedirect, trialBundleNames, trialDaysRemaining, trialEndActions } from '@/utils/subscription'
import { entitledFeaturePrefixes } from '@liwan/commercial-ui/app/utils/entitlementApps'
import { humanizeId } from '@liwan/ui/app/utils/humanizeId'
import { useCustomerCapabilities, useSubscriptionApi } from '@/composables/useSubscription'
const { t, te, locale } = useI18n(); const api = useSubscriptionApi(); const { can, readOnly } = useCustomerCapabilities(); const hydrated = useHydrated()
const allowed = computed(() => can('subscription.read'))
const { can: canAccess } = useAccess()
const isMissing = (cause: any) => (cause?.statusCode ?? cause?.status ?? cause?.response?.status) === 404
const { data, error, pending, refresh } = await useAsyncData('subscription:overview', async () => {
  // A secondary section that fails is reported as failed, never shown as empty.
  const failed = new Set<'usage' | 'branches' | 'invoices' | 'trial'>()
  const soft = <T,>(key: 'usage' | 'branches' | 'invoices' | 'trial', request: Promise<T>) => request.catch(() => { failed.add(key); return null })
  const [sub, usage, branches, invoices] = await Promise.all([
    api.subscription().catch((cause: any) => { if (isMissing(cause)) return null; throw cause }),
    soft('usage', api.usage()), soft('branches', api.branches()),
    can('billing.read') ? soft('invoices', api.invoices()) : Promise.resolve(null),
  ])
  const trial = sub?.applied && (sub.trial_ends_at || sub.trial_outcome) ? await soft('trial', api.trialEndPreview()) : null
  const bundleNames = trial && (trial.kept.bundle_revision_ids.length || trial.locked_bundle_revision_ids.length)
    ? await api.catalog().then(catalog => trialBundleNames(catalog.bundles), () => ({}))
    : {}
  return { sub, usage, branches, invoices, trial, bundleNames, failed }
}, { immediate: allowed.value })
const display = computed(() => {
  const sub = data.value?.sub
  if (!sub) return null
  return sub.pending_order && orderOutcome(sub.pending_order) === 'recovering' ? 'activating' : subscriptionDisplayState(sub)
})
// The one action block: only when the customer must act on an order (payment due or activation failed).
const collection = computed(() => data.value?.sub?.pending_order?.collection)
const needsAction = computed(() => (display.value === 'awaiting_payment' && collection.value?.state !== 'in_progress') || display.value === 'failed')
const entitlement = computed(() => data.value?.sub?.applied?.entitlement ?? null)
const trialEndsAt = computed(() => data.value?.sub?.trial_ends_at ?? null)
const trialDaysLeft = computed(() => trialDaysRemaining(trialEndsAt.value))
const trialActions = computed(() => trialEndActions(data.value?.trial?.status ?? null, data.value?.sub?.state ?? null, can('subscription.manage')))
const converting = ref(false)
const convertError = ref<string | undefined>()
const retryingTrial = ref(false)
const retryError = ref<string | undefined>()

async function retryTrial() {
  if (!hydrated.value || retryingTrial.value || !trialActions.value.canRetry) return
  retryingTrial.value = true
  retryError.value = undefined
  try {
    const trial = await api.retryTrialEnd()
    if (data.value) data.value = { ...data.value, trial }
    await refresh()
  } catch (cause) {
    retryError.value = t(refusalKey(refusalCode(cause)) ?? 'subscription.trialEnd.retryFailed')
  } finally {
    retryingTrial.value = false
  }
}

async function convertTrial() {
  if (!hydrated.value || converting.value || !trialActions.value.canConvert) return
  converting.value = true; convertError.value = undefined
  try {
    const result = await api.convertTrial()
    const url = result.attempt?.redirect_url ? safePaymentRedirect(result.attempt.redirect_url, window.location.origin) : null
    if (url) { window.location.assign(url); return }
    if (result.order) { await navigateTo({ path: '/subscription/status', query: { order: result.order.id } }); return }
    convertError.value = t('subscription.trial.activationPending')
  } catch (cause: any) { convertError.value = t(refusalKey(refusalCode(cause)) ?? 'subscription.trial.convertFailed') } finally { converting.value = false }
}
const entitledApps = computed(() => entitledFeaturePrefixes(entitlement.value?.features))
const appLabel = (app: string) => (te(`subscription.apps.${app}`) ? t(`subscription.apps.${app}`) : humanizeId(app))
definePageMeta({ middleware: 'customer-commercial' })
</script>
<template>
  <SharedSettingsPage>
    <SharedPageHeader :title="t('subscription.title')">
      <template #actions><UButton v-if="can('subscription.manage') && !trialActions.blocked" to="/subscription/change" icon="i-lucide-repeat" :disabled="!hydrated">{{ t('subscription.summary.change') }}</UButton></template>
    </SharedPageHeader>
    <SharedForbiddenState v-if="!allowed" />
    <SharedPageState v-else :loading="pending" :error="error" @retry="refresh">
      <div v-if="data && !data.sub" class="grid gap-(--liwan-gap-card)">
        <SharedRecordSection variant="panel" :title="t('subscription.summary.plan')">
          <p class="text-sm text-muted">{{ t('subscription.summary.none') }}</p>
          <UButton v-if="can('subscription.manage')" class="mt-3" to="/subscription/change" :disabled="!hydrated">{{ t('subscription.trial.startSetup') }}</UButton>
        </SharedRecordSection>
      </div>
      <div v-else-if="data && data.sub" class="grid gap-(--liwan-gap-card)">
        <UAlert v-if="readOnly" color="info" variant="subtle" :title="t('subscription.trialEnd.accountReadOnly')" />
        <SubscriptionTrialEndPanel
          v-if="data.trial"
          :preview="data.trial"
          :bundle-names="data.bundleNames"
          :can-manage-team="canAccess('access.users.read')"
          :can-open-documents="canAccess('documents.items.read')"
          :can-open-storage="canAccess('settings.company.manage')"
          :can-read-branches="allowed"
          :can-read-billing="can('billing.read')"
        >
          <template #actions>
            <UButton v-if="trialActions.canRetry" data-testid="trial-retry" size="sm" :disabled="!hydrated || retryingTrial" :loading="retryingTrial" @click="retryTrial">{{ t('subscription.trialEnd.retry') }}</UButton>
            <UButton v-if="trialActions.canConvert" size="sm" color="neutral" variant="outline" :disabled="!hydrated || converting" :loading="converting" @click="convertTrial">{{ t('subscription.trial.convert') }}</UButton>
            <UButton v-if="trialActions.blocked" size="sm" color="neutral" variant="outline" :disabled="!hydrated || retryingTrial" @click="refresh()">{{ t('subscription.trialEnd.refresh') }}</UButton>
          </template>
        </SubscriptionTrialEndPanel>
        <UAlert v-else-if="data.sub.state === 'trialing' && trialDaysLeft !== null" id="trial-end" :color="trialDaysLeft <= 3 ? 'warning' : 'info'" variant="subtle" icon="i-lucide-hourglass"
          :title="t('subscription.trial.daysLeft', { count: trialDaysLeft })"
          :description="`${t('subscription.trial.endsOn', { date: formatDate(trialEndsAt, 'Asia/Riyadh') })}${trialDaysLeft <= 3 ? ' — ' + t('subscription.trial.expiring') : ''}`">
          <template #actions><UButton v-if="trialActions.canConvert" size="sm" color="neutral" variant="outline" :disabled="!hydrated || converting" :loading="converting" @click="convertTrial">{{ t('subscription.trial.convert') }}</UButton></template>
        </UAlert>
        <UAlert v-if="data.failed.has('trial')" color="warning" variant="subtle" :title="t('subscription.trialEnd.previewFailed')">
          <template #actions><UButton size="sm" color="neutral" variant="outline" :disabled="!hydrated" @click="refresh()">{{ t('subscription.trialEnd.refresh') }}</UButton></template>
        </UAlert>
        <UAlert v-if="retryError" color="error" variant="subtle" role="alert" :title="retryError" />
        <UAlert v-if="convertError" color="error" variant="subtle" :title="convertError" />
        <SharedRecordSection
          v-if="data.sub.pending_order || data.sub.target" :variant="needsAction ? 'action' : 'tinted'" data-testid="pending-change"
          :title="t(collection?.state === 'in_progress' ? 'subscription.status.outcomes.charging.title' : 'subscription.summary.pending')"
          :description="t('subscription.summary.pendingHint')"
        >
          <p v-if="collection?.state === 'in_progress' && collection.resolve_by" role="status" class="text-sm text-muted">
            {{ t('subscription.status.chargeResolveBy', { date: formatDateTime(collection.resolve_by, 'Asia/Riyadh') }) }}
          </p>
          <template v-if="data.sub.pending_order" #actions><UButton size="sm" :color="needsAction ? 'primary' : 'neutral'" :variant="needsAction ? 'solid' : 'outline'" :to="{ path: '/subscription/status', query: { order: data.sub.pending_order.id } }">{{ t('subscription.summary.viewStatus') }}</UButton></template>
        </SharedRecordSection>
        <SharedRecordSection variant="panel" :title="t('subscription.summary.plan')"><template #actions><SharedStatusBadge v-if="display" data-slot="subscription-state" :data-state="display" :tone="subscriptionStateBadge(display).tone" :label="t(subscriptionStateBadge(display).labelKey)" /></template>
          <p v-if="!data.sub.applied" class="text-sm text-muted">{{ t('subscription.summary.none') }}</p>
          <SharedPropertiesPanel v-else>
            <SharedPropertyRow :label="t('subscription.summary.cadence')" :value="data.sub.applied.cadence.count === 1 ? t(`subscription.cadence.${data.sub.applied.cadence.unit}.one`) : t(`subscription.cadence.${data.sub.applied.cadence.unit}.many`, { count: data.sub.applied.cadence.count })" />
            <SharedPropertyRow v-if="data.sub.renewal_at" :label="t('subscription.summary.renewal')">{{ formatDate(data.sub.renewal_at) }}</SharedPropertyRow><SharedPropertyRow v-else :label="t('subscription.summary.renewal')" :value="null" />
          </SharedPropertiesPanel>
        </SharedRecordSection>
        <SharedRecordSection variant="panel" :title="t('subscription.summary.services')">
          <p v-if="!entitledApps.length" class="text-sm text-muted">{{ t('subscription.summary.noServices') }}</p>
          <ul v-else class="flex flex-wrap gap-2"><li v-for="app in entitledApps" :key="app"><SharedStatusBadge tone="neutral" variant="subtle" :label="appLabel(app)" /></li></ul>
        </SharedRecordSection>
        <SharedRecordSection id="storage-usage" :title="t('subscription.usage.title')">
          <SubscriptionUsagePanel v-if="data.usage" :usage="data.usage" />
          <UAlert v-else color="warning" variant="subtle" role="status" :title="t(data.failed.has('usage') ? 'subscription.sectionError' : 'subscription.usage.unavailableNote')" />
        </SharedRecordSection>
        <SharedRecordSection variant="list" :title="t('subscription.branches.title')"><template #actions><UButton to="/subscription/branches" color="neutral" variant="link">{{ t('subscription.branches.title') }}</UButton></template>
          <SubscriptionBranchSummary v-if="data.branches" :summary="data.branches" />
          <UAlert v-else-if="data.failed.has('branches')" class="m-(--liwan-card-pad)" color="warning" variant="subtle" role="status" :title="t('subscription.sectionError')" />
        </SharedRecordSection>
        <SharedRecordSection v-if="data.invoices || data.failed.has('invoices')" variant="list" :title="t('subscription.invoices.preview')"><template #actions><UButton to="/subscription/invoices" color="neutral" variant="link">{{ t('subscription.invoices.all') }}</UButton></template>
          <UAlert v-if="!data.invoices" class="m-(--liwan-card-pad)" color="warning" variant="subtle" role="status" :title="t('subscription.sectionError')" />
          <p v-else-if="!data.invoices.items.length" class="p-(--liwan-card-pad) text-sm text-muted">{{ t('subscription.invoices.empty') }}</p>
          <ul v-else class="divide-y divide-default"><li v-for="inv in data.invoices.items.slice(0, 3)" :key="inv.id" class="flex items-center justify-between gap-3 px-(--liwan-card-pad) py-3"><NuxtLink :to="`/subscription/invoices/${encodeURIComponent(inv.id)}`" class="font-medium hover:underline">{{ inv.number ?? inv.id }}</NuxtLink><span class="tabular-nums">{{ formatSubscriptionMoney(inv.total, locale) }}</span></li></ul>
        </SharedRecordSection>
      </div>
    </SharedPageState>
  </SharedSettingsPage>
</template>
