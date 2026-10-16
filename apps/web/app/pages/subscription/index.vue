<script setup lang="ts">
import { subscriptionStateBadge } from '@/utils/subscription'
import { subscriptionDisplayState } from '@webvue/commercial-contracts'
import { formatSubscriptionMoney } from '@/utils/subscription'
import { entitledFeaturePrefixes } from '@webvue/commercial-ui/app/utils/entitlementApps'
import { humanizeId } from '@webvue/ui/app/utils/humanizeId'
import { useCustomerCapabilities, useSubscriptionApi } from '@/composables/useSubscription'
const { t, te, locale } = useI18n(); const api = useSubscriptionApi(); const { can } = useCustomerCapabilities(); const hydrated = useHydrated()
const allowed = computed(() => can('subscription.read'))
const { data, error, pending, refresh } = await useAsyncData('subscription:overview', async () => {
  const [sub, usage, branches, invoices] = await Promise.all([
    api.subscription(), api.usage().catch(() => null), api.branches().catch(() => null),
    can('billing.read') ? api.invoices().catch(() => null) : Promise.resolve(null),
  ])
  return { sub, usage, branches, invoices }
}, { immediate: allowed.value })
const display = computed(() => (data.value ? subscriptionDisplayState(data.value.sub) : null))
const entitlement = computed(() => data.value?.sub.applied?.entitlement ?? null)
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
    <SharedPageHeader :title="t('subscription.title')" :description="t('subscription.description')">
      <template #actions><UButton v-if="can('subscription.manage')" to="/subscription/change" icon="i-lucide-repeat" :disabled="!hydrated">{{ t('subscription.summary.change') }}</UButton></template>
    </SharedPageHeader>
    <SharedForbiddenState v-if="!allowed" />
    <SharedPageState v-else :loading="pending" :error="error" @retry="refresh">
      <div v-if="data" class="space-y-6">
        <SharedRecordSection :title="t('subscription.summary.plan')"><template #actions><SharedStatusBadge v-if="display" data-slot="subscription-state" :data-state="display" :tone="subscriptionStateBadge(display).tone" :label="t(subscriptionStateBadge(display).labelKey)" /></template>
          <p v-if="!data.sub.applied" class="text-sm text-muted">{{ t('subscription.summary.none') }}</p>
          <SharedPropertiesPanel v-else>
            <SharedPropertyRow :label="t('subscription.summary.cadence')" :value="data.sub.applied.cadence.count === 1 ? t(`subscription.cadence.${data.sub.applied.cadence.unit}.one`) : t(`subscription.cadence.${data.sub.applied.cadence.unit}.many`, { count: data.sub.applied.cadence.count })" />
            <SharedPropertyRow v-if="data.sub.renewal_at" :label="t('subscription.summary.renewal')"><bdi dir="ltr">{{ data.sub.renewal_at }}</bdi></SharedPropertyRow><SharedPropertyRow v-else :label="t('subscription.summary.renewal')" :value="null" />
          </SharedPropertiesPanel>
          <div v-if="data.sub.pending_order || data.sub.target" class="mt-4 rounded-lg bg-elevated p-3" data-testid="pending-change">
            <p class="font-medium">{{ t('subscription.summary.pending') }}</p>
            <p class="text-sm text-muted">{{ t('subscription.summary.pendingHint') }}</p>
            <UButton v-if="data.sub.pending_order" class="mt-2" size="sm" color="neutral" variant="outline" :to="{ path: '/subscription/status', query: { order: data.sub.pending_order.id } }">{{ t('subscription.summary.viewStatus') }}</UButton>
          </div>
        </SharedRecordSection>
        <SharedRecordSection :title="t('subscription.summary.services')">
          <p v-if="!entitledApps.length" class="text-sm text-muted">{{ t('subscription.summary.noServices') }}</p>
          <ul v-else class="flex flex-wrap gap-2"><li v-for="app in entitledApps" :key="app"><UBadge color="neutral" variant="subtle">{{ appLabel(app) }}</UBadge></li></ul>
        </SharedRecordSection>
        <SharedRecordSection :title="t('subscription.usage.title')">
          <SubscriptionUsagePanel v-if="data.usage" :usage="data.usage" />
          <p v-else class="text-sm text-muted" role="status">{{ t('subscription.usage.unavailableNote') }}</p>
        </SharedRecordSection>
        <SharedRecordSection :title="t('subscription.branches.title')"><template #actions><UButton to="/subscription/branches" color="neutral" variant="link">{{ t('subscription.branches.title') }}</UButton></template>
          <SubscriptionBranchSummary v-if="data.branches" :summary="data.branches" />
        </SharedRecordSection>
        <SharedRecordSection v-if="data.invoices" :title="t('subscription.invoices.preview')"><template #actions><UButton to="/subscription/invoices" color="neutral" variant="link">{{ t('subscription.invoices.all') }}</UButton></template>
          <p v-if="!data.invoices.items.length" class="text-sm text-muted">{{ t('subscription.invoices.empty') }}</p>
          <ul v-else class="divide-y divide-default"><li v-for="inv in data.invoices.items.slice(0, 3)" :key="inv.id" class="flex justify-between gap-3 py-2"><NuxtLink :to="`/subscription/invoices/${encodeURIComponent(inv.id)}`">{{ inv.number ?? inv.id }}</NuxtLink><span class="tabular-nums">{{ formatSubscriptionMoney(inv.total, locale) }}</span></li></ul>
        </SharedRecordSection>
        <SharedRecordSection :title="t('subscription.autoRenew.title')">
          <SubscriptionAutoRenewControl :enabled="data.sub.auto_renew.enabled" :can-manage="can('subscription.manage')" :pending="arBusy" :hydrated="hydrated" @change="setAutoRenew" />
          <UAlert v-if="arError" class="mt-3" color="error" variant="subtle" :title="t('errors.generic')" />
        </SharedRecordSection>
      </div>
    </SharedPageState>
  </SharedSettingsPage>
</template>
