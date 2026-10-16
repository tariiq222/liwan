<script setup lang="ts">
import { invoiceStatusBadge } from '@nasq/commercial-ui/app/utils/commercialBadges'
import { formatCommercialMoney } from '@nasq/commercial-ui/app/utils/commercial'
import { cancellationErrorKey, branchSummaryText, customersReturnTo, isNotAvailable } from '@/utils/vendorSubscriptions'
import { useVendorSubscriptions } from '@/composables/useVendorSubscriptions'
import { useVendorCommercial } from '@/composables/useVendorCommercial'
import { entitledSelections } from '@/utils/vendorEntitlement'
definePageMeta({ middleware: 'vendor', vendorCapability: 'vendor.read' })
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
const planName = computed(() => extra.value?.plans.value?.items.find(p => p.id === view.value?.applied?.plan_revision_id)?.name)
const release = computed(() => extra.value?.releases.value?.find(r => r.id === view.value?.applied?.entitlement.catalog_release_id) ?? null)
const selections = computed(() => entitledSelections(release.value, view.value?.applied?.entitlement.features))
const branchText = computed(() => (extra.value?.branches.value ? branchSummaryText(extra.value.branches.value) : null))
const invoices = computed(() => extra.value?.invoices.value?.items ?? [])
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
        <UButton v-if="customer && canTerms && view" :to="{ path: `/vendor/customers/${encodeURIComponent(id)}/terms/new`, ...selfTo }" color="neutral" variant="outline" icon="i-lucide-sliders-horizontal">{{ t('vendor.customers.customizeTerms') }}</UButton>
        <UButton v-if="customer && canChange" :to="{ path: `/vendor/customers/${encodeURIComponent(id)}/change`, ...selfTo }" icon="i-lucide-repeat">{{ t('vendor.customers.changeSubscription') }}</UButton>
      </template>

      <div v-if="customer" class="space-y-6">
        <UAlert v-if="customer.commercial_setup_required" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="t('vendor.customers.setupRequired')" :description="t('vendor.customers.setupHint')" />
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
        <SharedRecordSection v-if="canBilling" :title="t('vendor.customers.sections.invoices')">
          <p v-if="extra?.invoices.unavailable" class="text-sm text-muted">{{ t('vendor.customers.sectionUnavailable') }}</p>
          <p v-else-if="!invoices.length" class="text-sm text-muted">{{ t('vendor.invoices.empty') }}</p>
          <ul v-else class="divide-y divide-default">
            <li v-for="i in invoices" :key="i.id" class="flex flex-wrap items-center justify-between gap-3 py-2" data-testid="customer-invoice">
              <NuxtLink :to="{ path: `/vendor/invoices/${encodeURIComponent(i.id)}`, query: { returnTo: route.fullPath } }">{{ i.number ?? t('vendor.invoices.draftNumber') }}</NuxtLink>
              <bdi dir="ltr" class="tabular-nums">{{ formatCommercialMoney(i.total, locale) }}</bdi>
              <SharedStatusBadge :tone="invoiceStatusBadge(i.status, 'vendor.invoices.status').tone" :label="t(invoiceStatusBadge(i.status, 'vendor.invoices.status').labelKey)" />
            </li>
          </ul>
        </SharedRecordSection>
        <SharedRecordSection :title="t('vendor.customers.sections.terms')">
          <p v-if="view?.applied?.terms_revision_id" class="text-sm">{{ t('vendor.customers.terms.active') }}</p>
          <p v-else class="text-sm text-muted">{{ t('vendor.customers.terms.noneActive') }}</p>
          <p class="mt-2 text-sm text-muted">{{ t('vendor.customers.terms.isolation') }}</p>
        </SharedRecordSection>
        <SharedRecordSection :title="t('vendor.customers.sections.audit')">
          <UButton to="/vendor/audit" color="neutral" variant="link">{{ t('vendor.customers.openAudit') }}</UButton>
        </SharedRecordSection>
        <details v-if="view" class="text-sm"><summary class="cursor-pointer text-muted">{{ t('vendor.customers.technical') }}</summary>
          <dl class="mt-3 space-y-2"><div><dt>{{ t('vendor.customers.techSubscription') }}</dt><dd dir="ltr">{{ view.id }}</dd></div><div><dt>{{ t('vendor.customers.techRevision') }}</dt><dd dir="ltr">{{ view.revision }}</dd></div><div v-if="view.applied"><dt>{{ t('vendor.customers.techDigest') }}</dt><dd class="break-all" dir="ltr">{{ view.applied.entitlement.digest }}</dd></div></dl>
        </details>
      </div>

  <template #aside><VendorSubscriptionSummary v-if="view" :subscription="view" :plan-name="planName"><SharedPropertyRow v-if="customer?.tenant_id" :label="t('vendor.customers.openTenant')"><NuxtLink v-if="customer.tenant_id" :to="{ path: `/vendor/tenants/${encodeURIComponent(customer.tenant_id)}` }" class="mt-3 inline-block text-sm text-primary">{{ t('vendor.customers.openTenant') }}</NuxtLink></SharedPropertyRow></VendorSubscriptionSummary><SharedPropertiesPanel v-else-if="customer?.tenant_id"><SharedPropertyRow v-if="customer?.tenant_id" :label="t('vendor.customers.openTenant')"><NuxtLink v-if="customer.tenant_id" :to="{ path: `/vendor/tenants/${encodeURIComponent(customer.tenant_id)}` }" class="mt-3 inline-block text-sm text-primary">{{ t('vendor.customers.openTenant') }}</NuxtLink></SharedPropertyRow></SharedPropertiesPanel></template>
</SharedRecordPage>
  <SharedUnsavedChanges v-if="!isChild" :dirty="Boolean(cancelReason.trim())" guard-route-updates />
</template>
