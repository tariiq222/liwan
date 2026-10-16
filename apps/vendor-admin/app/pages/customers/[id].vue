<script setup lang="ts">
import { invoiceStatusBadge } from '@nasq/commercial-ui/app/utils/commercialBadges'
import { formatCommercialMoney } from '@nasq/commercial-ui/app/utils/commercial'
import { cancellationErrorKey, branchSummaryText, customersReturnTo, isNotAvailable, subscriptionDisplayState } from '@/utils/vendorSubscriptions'
import { useVendorSubscriptions } from '@/composables/useVendorSubscriptions'
import { useVendorCommercial } from '@/composables/useVendorCommercial'
import { entitledSelections } from '@/utils/vendorEntitlement'
import { customerDisplayBadge } from '@/utils/vendorBadges'
import { CUSTOMER_TABS, clientTab, clientTabItems } from '@/utils/vendorClients'
definePageMeta({ capability: 'vendor.read' })
const { t, locale } = useI18n(); const route = useRoute(); const { can } = useVendorContext(); const api = useVendorSubscriptions()
const id = computed(() => String(route.params.id))
const isChild = computed(() => /\/(?:change\/?$|terms\/)/.test(route.path))
const backTo = computed(() => customersReturnTo(route.query.returnTo))
const { data: customer, error, pending, refresh } = await useAsyncData(() => `vendor:customer:${id.value}`, async () => {
  const c = await api.customer(id.value)
  if (!c) throw createError({ statusCode: 404, statusMessage: 'not_found' })
  return c
})
const hydrated = useHydrated()
const canBilling = computed(() => can('vendor.billing.manage'))
const offeredTabs = computed(() => CUSTOMER_TABS.filter(key => key !== 'invoices' || canBilling.value))
const tab = computed(() => clientTab(route.query.tab, offeredTabs.value))
const tabs = computed(() => clientTabItems(offeredTabs.value, tab.value, route, key => t(`vendor.clientTabs.${key}`), 'customer-tab'))
const operationsDirty = ref(false)
const sub = computed(() => customer.value?.subscription ?? null)
const subId = computed(() => sub.value?.id)
async function soft<T>(fn: () => Promise<T>): Promise<{ value: T | null; unavailable: boolean; failed: boolean }> {
  try { return { value: await fn(), unavailable: false, failed: false } } catch (e) { return { value: null, unavailable: isNotAvailable(e), failed: !isNotAvailable(e) } }
}
const { data: extra, refresh: refreshExtra } = await useAsyncData(() => `vendor:customer-extra:${id.value}`, async () => {
  const s = subId.value
  const [full, branches, usage, invoices, plans, releases] = await Promise.all([
    s ? soft(() => api.subscription(s)) : Promise.resolve({ value: null, unavailable: false, failed: false }),
    s ? soft(() => api.branches(s)) : Promise.resolve({ value: null, unavailable: false, failed: false }),
    s ? soft(() => api.usage(s)) : Promise.resolve({ value: null, unavailable: false, failed: false }),
    canBilling.value ? soft(() => api.listInvoices({ customer_id: id.value, limit: 10 })) : Promise.resolve({ value: null, unavailable: false, failed: false }),
    soft(() => useVendorCommercial().listPlans({ limit: 200 })),
    soft(() => useVendorCommercial().releases()),
  ])
  return { full, branches, usage, invoices, plans, releases }
}, { watch: [subId] })
const view = computed(() => extra.value?.full.value ?? sub.value)
const planNameOf = (planRevisionId: string | undefined) => extra.value?.plans.value?.items.find(p => p.id === planRevisionId)?.name
// Before the first activation only the order's target carries the plan: show it with its pending state.
const pendingPlanName = computed(() => (view.value?.pending_order ? planNameOf(view.value.target?.plan_revision_id) : undefined))
const planName = computed(() => planNameOf(view.value?.applied?.plan_revision_id) ?? (pendingPlanName.value ? t('vendor.customers.pendingPlan', { plan: pendingPlanName.value }) : undefined))
const release = computed(() => extra.value?.releases.value?.find(r => r.id === view.value?.applied?.entitlement.catalog_release_id) ?? null)
const selections = computed(() => entitledSelections(release.value, view.value?.applied?.entitlement.features))
const branchText = computed(() => (extra.value?.branches.value ? branchSummaryText(extra.value.branches.value) : null))
const invoices = computed(() => extra.value?.invoices.value?.items ?? [])
const display = computed(() => (view.value ? subscriptionDisplayState(view.value) : null))
const selfTo = computed(() => ({ query: { returnTo: backTo.value } }))
const canTerms = computed(() => can('vendor.pricing.manage') && can('vendor.subscriptions.manage'))
const canChange = computed(() => can('vendor.subscriptions.manage') && Boolean(view.value) && !view.value?.pending_order)
const cancelOpen = ref(false)
const cancelReason = ref('')
const cancelBusy = ref(false)
const cancelFailure = ref<string | undefined>()
const canCancel = computed(() => can('vendor.subscriptions.manage') && !error.value && !extra.value?.full.failed && !extra.value?.full.unavailable && view.value?.pending_order?.payment_state === 'awaiting_payment' && view.value.pending_order.fulfillment_state === 'not_started' && view.value.pending_order.kind !== 'renewal')
const validCancelReason = computed(() => cancelReason.value.trim().length >= 3 && cancelReason.value.trim().length <= 1000)
async function refreshCancellationState() {
  await refresh()
  await refreshExtra()
}
async function cancelPendingOrder() {
  const order = view.value?.pending_order
  if (!hydrated.value || cancelBusy.value || !canCancel.value || !order || !validCancelReason.value) return
  cancelBusy.value = true; cancelFailure.value = undefined
  try {
    await api.cancelOrder(order.id, cancelReason.value.trim())
    cancelReason.value = ''; cancelOpen.value = false
  } catch (cause) {
    cancelFailure.value = t(cancellationErrorKey(cause))
  } finally {
    try { await refreshCancellationState() } finally { cancelBusy.value = false }
  }
}
</script>
<template>
  <NuxtPage v-if="isChild" />

    <SharedRecordPage v-else :title="customer?.name ?? t('vendor.customers.details')" :back-to="backTo" :loading="pending" :error="error" @retry="refresh">
      <template #actions>
        <UButton v-if="customer && canTerms && view" :to="{ path: `/customers/${encodeURIComponent(id)}/terms/new`, ...selfTo }" color="neutral" variant="outline" icon="i-lucide-sliders-horizontal">{{ t('vendor.customers.customizeTerms') }}</UButton>
        <UButton v-if="customer && canChange" :to="{ path: `/customers/${encodeURIComponent(id)}/change`, ...selfTo }" icon="i-lucide-repeat">{{ t('vendor.customers.changeSubscription') }}</UButton>
      </template>
      <template v-if="customer" #summary>
        <div class="flex flex-wrap items-center gap-2" data-testid="customer-badges">
          <SharedStatusBadge v-if="customer.commercial_setup_required" tone="warning" :label="t('vendor.customers.setupRequired')" />
          <SharedStatusBadge v-if="display" :tone="customerDisplayBadge(display).tone" :label="t(customerDisplayBadge(display).labelKey)" />
          <SharedStatusBadge v-else tone="neutral" variant="outline" :label="t('vendor.customers.noSubscription')" />
          <SharedStatusBadge v-if="!customer.tenant_id" tone="neutral" variant="outline" :label="t('vendor.customers.noWorkspace')" />
        </div>
      </template>
      <template #tabs><SharedRouteTabs :items="tabs" :ariaLabel="t('vendor.clientTabs.label')" /></template>

      <div v-if="customer" class="space-y-6">
        <template v-if="tab === 'summary'">
          <UAlert v-if="customer.commercial_setup_required" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="t('vendor.customers.setupRequired')" :description="t('vendor.customers.setupHint')" />
          <div class="grid gap-6 lg:grid-cols-2">
            <SharedRecordSection :title="t('vendor.customers.sections.subscription')">
              <VendorSubscriptionSummary v-if="view" :subscription="view" :plan-name="planName" />
              <p v-else class="text-sm text-muted">{{ t('vendor.customers.noSubscription') }}</p>
            </SharedRecordSection>
            <SharedRecordSection :title="t('vendor.customers.sections.workspace')">
              <VendorTenantProperties v-if="customer.tenant_id" :tenant-id="customer.tenant_id" />
              <p v-else class="text-sm text-muted">{{ t('vendor.customers.noWorkspaceYet') }}</p>
            </SharedRecordSection>
          </div>
        </template>

        <template v-else-if="tab === 'subscription'">
          <SharedRecordSection :title="t('vendor.customers.sections.subscription')">

            <p v-if="!view" class="text-sm text-muted">{{ t('vendor.customers.noSubscription') }}</p>
            <div v-if="canCancel || cancelFailure" class="mt-4 space-y-3">
              <UAlert v-if="cancelFailure" color="error" variant="subtle" :title="cancelFailure" />
              <SharedInlineConfirm v-if="cancelOpen && canCancel" :title="t('vendor.customers.cancelOrder.title')" :description="t('vendor.customers.cancelOrder.description')" :confirm-label="t('vendor.customers.cancelOrder.action')" :pending="cancelBusy" :disabled="!hydrated || cancelBusy || !validCancelReason" @confirm="cancelPendingOrder" @cancel="cancelOpen = false; cancelReason = ''; cancelFailure = undefined">
                <UFormField :label="t('vendor.customers.cancelOrder.reason')" required class="mt-3"><UTextarea v-model="cancelReason" :maxlength="1000" :disabled="!hydrated || cancelBusy" class="w-full" /></UFormField>
              </SharedInlineConfirm>
              <UButton v-else-if="canCancel" color="error" variant="outline" :disabled="!hydrated || cancelBusy" @click="cancelOpen = true">{{ t('vendor.customers.cancelOrder.action') }}</UButton>
            </div>
            <UAlert v-if="extra?.full.failed" class="mt-3" color="error" variant="subtle" :title="t('vendor.customers.cancelOrder.refreshFailed')"><template #actions><UButton color="neutral" variant="outline" :disabled="!hydrated || cancelBusy" @click="refreshCancellationState">{{ t('app.retry') }}</UButton></template></UAlert>

          </SharedRecordSection>
          <SharedRecordSection v-if="view?.applied" :title="t('vendor.customers.sections.services')">
            <VendorEntitlementSummary :release="release" :selections="selections" include-core />
          </SharedRecordSection>
          <SharedRecordSection v-if="view" :title="t('vendor.customers.sections.branches')">
            <p v-if="extra?.branches.unavailable" class="text-sm text-muted">{{ t('vendor.customers.sectionUnavailable') }}</p>
            <dl v-else-if="branchText" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 tabular-nums" data-testid="branch-summary">
              <div><dt class="text-sm text-muted">{{ t('vendor.customers.branchesHq') }}</dt><dd class="font-semibold">{{ t('vendor.customers.included') }}</dd></div>
              <div><dt class="text-sm text-muted">{{ t('vendor.customers.branchesFree') }}</dt><dd class="font-semibold">{{ branchText.freeUsed }} / {{ branchText.freeAllowed }}</dd></div>
              <div><dt class="text-sm text-muted">{{ t('vendor.customers.branchesPaid') }}</dt><dd class="font-semibold">{{ branchText.paid }}</dd></div>
              <div><dt class="text-sm text-muted">{{ t('vendor.customers.branchesLimit') }}</dt><dd class="font-semibold">{{ branchText.limit === null ? t('vendor.pricing.limit.unlimited') : branchText.limit }}</dd></div>
            </dl>
            <p v-else class="text-sm text-muted">{{ t('vendor.customers.usage.none') }}</p>
          </SharedRecordSection>
          <SharedRecordSection v-if="view" :title="t('vendor.customers.sections.usage')">
            <p v-if="extra?.usage.unavailable" class="text-sm text-muted">{{ t('vendor.customers.sectionUnavailable') }}</p>
            <VendorUsageMeters v-else :usage="extra?.usage.value" />
          </SharedRecordSection>
          <details v-if="view" class="text-sm"><summary class="cursor-pointer text-muted">{{ t('vendor.customers.technical') }}</summary>
            <dl class="mt-3 space-y-2"><div><dt>{{ t('vendor.customers.techSubscription') }}</dt><dd dir="ltr">{{ view.id }}</dd></div><div><dt>{{ t('vendor.customers.techRevision') }}</dt><dd dir="ltr">{{ view.revision }}</dd></div><div v-if="view.applied"><dt>{{ t('vendor.customers.techDigest') }}</dt><dd class="break-all" dir="ltr">{{ view.applied.entitlement.digest }}</dd></div></dl>
          </details>
        </template>

        <SharedRecordSection v-else-if="tab === 'invoices'" :title="t('vendor.customers.sections.invoices')">
          <p v-if="extra?.invoices.unavailable" class="text-sm text-muted">{{ t('vendor.customers.sectionUnavailable') }}</p>
          <p v-else-if="!invoices.length" class="text-sm text-muted">{{ t('vendor.invoices.empty') }}</p>
          <ul v-else class="divide-y divide-default">
            <li v-for="i in invoices" :key="i.id" class="flex flex-wrap items-center justify-between gap-3 py-2" data-testid="customer-invoice">
              <NuxtLink :to="{ path: `/invoices/${encodeURIComponent(i.id)}`, query: { returnTo: route.fullPath } }">{{ i.number ?? t('vendor.invoices.draftNumber') }}</NuxtLink>
              <bdi dir="ltr" class="tabular-nums">{{ formatCommercialMoney(i.total, locale) }}</bdi>
              <SharedStatusBadge :tone="invoiceStatusBadge(i.status, 'vendor.invoices.status').tone" :label="t(invoiceStatusBadge(i.status, 'vendor.invoices.status').labelKey)" />
            </li>
          </ul>
        </SharedRecordSection>

        <template v-else-if="tab === 'workspace' || tab === 'operations'">
          <SharedEmptyState v-if="!customer.tenant_id" :title="t('vendor.customers.noWorkspaceYet')" />
          <VendorWorkspacePanel v-else-if="tab === 'workspace'" :tenant-id="customer.tenant_id" />
          <VendorTenantOperationsPanel v-else v-model:dirty="operationsDirty" :tenant-id="customer.tenant_id" />
        </template>

        <template v-else>
          <SharedRecordSection :title="t('vendor.customers.sections.terms')">
            <p v-if="view?.applied?.terms_revision_id" class="text-sm">{{ t('vendor.customers.terms.active') }}</p>
            <p v-else class="text-sm text-muted">{{ t('vendor.customers.terms.noneActive') }}</p>
            <p class="mt-2 text-sm text-muted">{{ t('vendor.customers.terms.isolation') }}</p>
          </SharedRecordSection>
          <SharedRecordSection :title="t('vendor.customers.sections.audit')">
            <UButton :to="{ path: '/audit', query: { customer_id: id } }" color="neutral" variant="link">{{ t('vendor.customers.openAudit') }}</UButton>
          </SharedRecordSection>
        </template>
      </div>
</SharedRecordPage>
  <SharedUnsavedChanges v-if="!isChild" :dirty="Boolean(cancelReason.trim()) || operationsDirty" guard-route-updates />
</template>
