<script setup lang="ts">
import SettingsLayout from '@/components/settings/SettingsLayout.vue'
import { subscriptionDisplayState } from '@nasq/commercial-contracts'
import { formatSubscriptionMoney } from '@/utils/subscription'
import { entitledFeaturePrefixes } from '@/utils/entitlementApps'
import { humanizeId } from '@/utils/labelFallback'
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
  <SettingsLayout width="detail">
    <SharedPageHeader :title="t('subscription.title')" :description="t('subscription.description')">
      <template #actions><UButton v-if="can('subscription.manage')" to="/subscription/change" icon="i-lucide-repeat" :disabled="!hydrated">{{ t('subscription.summary.change') }}</UButton></template>
    </SharedPageHeader>
    <p v-if="!allowed" class="text-muted">{{ t('subscription.forbidden') }}</p>
    <SharedPageState v-else :loading="pending" :error="error" @retry="refresh">
      <div v-if="data" class="space-y-6">
        <UCard>
          <template #header><div class="flex flex-wrap items-center justify-between gap-3"><h2 class="font-semibold">{{ t('subscription.summary.plan') }}</h2><SubscriptionStateBadge v-if="display" :state="display" /></div></template>
          <p v-if="!data.sub.applied" class="text-sm text-muted">{{ t('subscription.summary.none') }}</p>
          <dl v-else class="grid gap-3 sm:grid-cols-3">
            <div><dt class="text-sm text-muted">{{ t('subscription.summary.cadence') }}</dt><dd class="font-medium">{{ data.sub.applied.cadence.count === 1 ? t(`subscription.cadence.${data.sub.applied.cadence.unit}.one`) : t(`subscription.cadence.${data.sub.applied.cadence.unit}.many`, { count: data.sub.applied.cadence.count }) }}</dd></div>
            <div><dt class="text-sm text-muted">{{ t('subscription.summary.renewal') }}</dt><dd class="font-medium tabular-nums"><bdi dir="ltr">{{ data.sub.renewal_at ?? '—' }}</bdi></dd></div>
          </dl>
          <div v-if="data.sub.pending_order || data.sub.target" class="mt-4 rounded-lg bg-elevated p-3" data-testid="pending-change">
            <p class="font-medium">{{ t('subscription.summary.pending') }}</p>
            <p class="text-sm text-muted">{{ t('subscription.summary.pendingHint') }}</p>
            <UButton v-if="data.sub.pending_order" class="mt-2" size="sm" color="neutral" variant="outline" :to="{ path: '/subscription/status', query: { order: data.sub.pending_order.id } }">{{ t('subscription.summary.viewStatus') }}</UButton>
          </div>
        </UCard>
        <UCard>
          <template #header><h2 class="font-semibold">{{ t('subscription.summary.services') }}</h2></template>
          <p v-if="!entitledApps.length" class="text-sm text-muted">{{ t('subscription.summary.noServices') }}</p>
          <ul v-else class="flex flex-wrap gap-2"><li v-for="app in entitledApps" :key="app"><UBadge color="neutral" variant="subtle">{{ appLabel(app) }}</UBadge></li></ul>
        </UCard>
        <UCard>
          <template #header><h2 class="font-semibold">{{ t('subscription.usage.title') }}</h2></template>
          <SubscriptionUsagePanel v-if="data.usage" :usage="data.usage" />
          <p v-else class="text-sm text-muted" role="status">{{ t('subscription.usage.unavailableNote') }}</p>
        </UCard>
        <UCard>
          <template #header><div class="flex items-center justify-between gap-3"><h2 class="font-semibold">{{ t('subscription.branches.title') }}</h2><UButton to="/subscription/branches" color="neutral" variant="link">{{ t('subscription.branches.title') }}</UButton></div></template>
          <SubscriptionBranchSummary v-if="data.branches" :summary="data.branches" />
        </UCard>
        <UCard v-if="data.invoices">
          <template #header><div class="flex items-center justify-between gap-3"><h2 class="font-semibold">{{ t('subscription.invoices.preview') }}</h2><UButton to="/subscription/invoices" color="neutral" variant="link">{{ t('subscription.invoices.all') }}</UButton></div></template>
          <p v-if="!data.invoices.items.length" class="text-sm text-muted">{{ t('subscription.invoices.empty') }}</p>
          <ul v-else class="divide-y divide-default"><li v-for="inv in data.invoices.items.slice(0, 3)" :key="inv.id" class="flex justify-between gap-3 py-2"><NuxtLink :to="`/subscription/invoices/${encodeURIComponent(inv.id)}`">{{ inv.number ?? inv.id }}</NuxtLink><span class="tabular-nums">{{ formatSubscriptionMoney(inv.total, locale) }}</span></li></ul>
        </UCard>
        <UCard>
          <SubscriptionAutoRenewControl :enabled="data.sub.auto_renew.enabled" :can-manage="can('subscription.manage')" :pending="arBusy" :hydrated="hydrated" @change="setAutoRenew" />
          <UAlert v-if="arError" class="mt-3" color="error" variant="subtle" :title="t('errors.generic')" />
        </UCard>
      </div>
    </SharedPageState>
  </SettingsLayout>
</template>
