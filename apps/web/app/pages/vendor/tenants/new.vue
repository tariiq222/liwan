<script setup lang="ts">
import type { Cadence } from '@nasq/commercial-contracts'
import { safeReturnTo } from '@/utils/safeReturnTo'
import { cadenceKey, cadenceLabel, commercialErrorKey } from '@/utils/vendorCommercial'
import { planTenantCustomerBody, planTenantQuoteBody } from '@/utils/vendorTenantPlan'
import { useVendorSubscriptions } from '@/composables/useVendorSubscriptions'
import { useVendorCommercial } from '@/composables/useVendorCommercial'
definePageMeta({ middleware: 'vendor', vendorCapability: 'vendor.tenants.manage' })
const { t } = useI18n(); const route = useRoute(); const { request } = useVendorApi(); const { can, sharedOnboardingEnabled: sharedEnabled, ready } = useVendorContext()
const hydrated = useHydrated(); const subscriptions = useVendorSubscriptions(); const commercial = useVendorCommercial()
await ready
const { data: targets, pending, error, refresh } = await useAsyncData('vendor:targets', () => sharedEnabled.value ? Promise.resolve({ items: [], total: 0 }) : request<{ items: { id: string; kind: string }[]; total: number }>('targets'))
const { data: catalog, error: catalogError, refresh: refreshCatalog } = await useAsyncData('vendor:catalog-published', () => sharedEnabled.value ? Promise.resolve({ items: [], total: 0 }) : request<{ items: { id: string; version: string; status: string; solution: { tiers?: { id: string; name: string }[] } }[]; total: number }>('catalog'))
const { data: plans, error: plansError, refresh: refreshPlans } = await useAsyncData('vendor:tenant-plans', () => sharedEnabled.value ? commercial.listPlans({ status: 'published', limit: 200 }).then(r => r.items) : Promise.resolve([]))
const published = computed(() => catalog.value?.items.filter(item => item.status === 'published') ?? [])
const selectedCatalog = computed(() => published.value.find(item => item.version === form.catalog_version))
const form = reactive({ name: '', commercial_mode: 'saas', hosting_model: 'managed', inventory_target: '', catalog_version: '', catalog_tier: '', reason: '', admin_name: '', admin_login: '', plan_revision_id: '', cadence: '' })
const selectedPlan = computed(() => plans.value?.find(p => p.id === form.plan_revision_id))
const cadenceItems = computed(() => (selectedPlan.value?.prices ?? []).map(p => ({ label: cadenceLabel(p.cadence, t), value: cadenceKey(p.cadence) })))
const selectedCadence = computed<Cadence | undefined>(() => selectedPlan.value?.prices.find(p => cadenceKey(p.cadence) === form.cadence)?.cadence)
const canSubscribe = computed(() => can('vendor.subscriptions.manage'))
const createdCustomer = ref<string | null>(null)
const creationRequestId = ref<string | null>(null)
const busy = ref(false); const saveError = ref<unknown>(null); const submitted = ref(false)
const dirty = computed(() => !submitted.value && Boolean(form.admin_name.trim() || form.admin_login.trim() || form.name.trim() || form.inventory_target || form.catalog_version || form.catalog_tier || form.plan_revision_id || form.reason.trim() || form.commercial_mode !== 'saas' || form.hosting_model !== 'managed'))
function fieldError(error: unknown): string {
  const value = error as { data?: { field?: unknown; data?: { field?: unknown } }; field?: unknown; response?: { _data?: { field?: unknown } } } | null
  const field = value?.data?.field ?? value?.data?.data?.field ?? value?.response?._data?.field ?? value?.field
  return typeof field === 'string' && ['name', 'inventory_target', 'catalog_version', 'catalog_tier', 'reason', 'admin_name', 'admin_login'].includes(field) ? `vendor.errors.field.${field}` : 'vendor.errors.save'
}
watch(() => form.catalog_version, () => { form.catalog_tier = '' })
watch(() => form.plan_revision_id, () => { form.cadence = '' })
async function submit() {
  if (!hydrated.value || !can('vendor.tenants.manage') || busy.value) return
  busy.value = true
  saveError.value = null
  try {
    if (sharedEnabled.value) {
      if (!canSubscribe.value || !selectedPlan.value || !selectedCadence.value) return
      // A retry after a failed quote or order reuses the customer instead of creating a duplicate;
      // the identity fields are locked once it exists so the reused customer never diverges from the form.
      // The server also deduplicates: one request id per submission returns the same customer on a lost response.
      creationRequestId.value ??= crypto.randomUUID()
      createdCustomer.value ??= (await subscriptions.createCustomer(planTenantCustomerBody(form, creationRequestId.value))).id
      const quote = await subscriptions.changeQuote(planTenantQuoteBody(createdCustomer.value, selectedPlan.value, selectedCadence.value))
      await subscriptions.placeOrder({ quote_id: quote.id, expected_subscription_revision: 0, idempotency_key: crypto.randomUUID() })
      submitted.value = true
      await navigateTo(`/vendor/customers/${encodeURIComponent(createdCustomer.value)}`)
      return
    }
    const tenantId = (await request<{ id: string }>('tenants', { method: 'POST', body: { name: form.name, commercial_mode: form.commercial_mode, hosting_model: form.hosting_model, inventory_target: form.inventory_target, catalog_version: form.catalog_version, catalog_tier: form.catalog_tier, reason: form.reason } })).id
    submitted.value = true
    const navigation = await navigateTo(`/vendor/tenants/${encodeURIComponent(tenantId)}`)
    if (navigation === false || navigation instanceof Error) submitted.value = false
  } catch (cause) { submitted.value = false; saveError.value = cause }
  finally { busy.value = false }
}
const errorKey = computed(() => (saveError.value ? (sharedEnabled.value ? commercialErrorKey(saveError.value) : fieldError(saveError.value)) : ''))
const backTo = computed(() => safeReturnTo(route.query.returnTo, '/vendor/tenants', ['/vendor/tenants']))
</script>
<template>
  <SharedCreatePanel :title="t('vendor.tenants.create')" :back-to="backTo">
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedForbiddenState v-if="!can('vendor.tenants.manage')" />
    <SharedPageState v-else :loading="pending || (!catalog && !catalogError) || (!plans && !plansError)" :error="error || catalogError || plansError" @retry="async () => { await refresh(); await refreshCatalog(); await refreshPlans() }">
      <form v-if="targets && catalog && plans" class="grid max-w-2xl gap-5" @submit.prevent="submit">
        <UAlert v-if="saveError" color="error" variant="subtle" :title="t(errorKey)" />
        <UFormField :label="t('vendor.tenants.fields.name')" required><UInput v-model="form.name" required maxlength="200" :disabled="Boolean(createdCustomer)" class="w-full" /></UFormField>
        <template v-if="sharedEnabled">
          <UAlert color="neutral" variant="subtle" :title="t('vendor.tenants.plan.hint')" />
          <UAlert v-if="!canSubscribe" color="warning" variant="subtle" :title="t('vendor.tenants.plan.forbidden')" />
          <UAlert v-else-if="!plans.length" color="neutral" variant="subtle" :title="t('vendor.tenants.plan.none')" />
          <UFormField :label="t('vendor.tenants.plan.field')" required><USelect v-model="form.plan_revision_id" :items="plans.map(p => ({ label: p.name, value: p.id }))" :disabled="!hydrated || busy || !canSubscribe" class="w-full" /></UFormField>
          <UFormField :label="t('vendor.tenants.plan.cadence')" required><USelect v-model="form.cadence" :items="cadenceItems" :disabled="!hydrated || busy || !selectedPlan" class="w-full" /></UFormField>
          <UFormField :label="t('vendor.tenants.fields.adminName')" required><UInput v-model="form.admin_name" required :disabled="Boolean(createdCustomer)" maxlength="120" autocomplete="name" class="w-full" /></UFormField>
          <UFormField :label="t('vendor.tenants.fields.adminLogin')" required><UInput v-model="form.admin_login" required :disabled="Boolean(createdCustomer)" type="email" maxlength="100" autocomplete="username" class="w-full" /></UFormField>
        </template>
        <template v-else>
          <UAlert v-if="!published.length" color="neutral" variant="subtle" :title="t('vendor.tenants.noPublishedCatalog')" />
          <UFormField :label="t('vendor.tenants.fields.mode')" required><USelect v-model="form.commercial_mode" :items="[{ label: t('vendor.mode.saas'), value: 'saas' }, { label: t('vendor.mode.nonSaas'), value: 'non_saas' }]" class="w-full" /></UFormField>
          <UFormField :label="t('vendor.tenants.fields.hosting')" required><USelect v-model="form.hosting_model" :items="[{ label: t('vendor.hosting.managed'), value: 'managed' }, { label: t('vendor.hosting.customerHosted'), value: 'customer_hosted' }]" class="w-full" /></UFormField>
          <UFormField :label="t('vendor.tenants.fields.target')" required :help="t('vendor.tenants.targetHelp')"><USelect v-model="form.inventory_target" :items="targets.items.map(item => ({ label: `${item.id} · ${t(`vendor.targetKind.${item.kind}`)}`, value: item.id }))" required class="w-full" /><p v-if="!targets.items.length" class="mt-1 text-xs text-muted">{{ t('vendor.tenants.noTargets') }}</p></UFormField>
          <UFormField :label="t('vendor.tenants.fields.catalogVersion')" required><USelect v-model="form.catalog_version" :items="published.map(item => ({ label: item.version, value: item.version }))" required class="w-full" /></UFormField>
          <UFormField :label="t('vendor.tenants.fields.catalogTier')" required><USelect v-model="form.catalog_tier" :items="(selectedCatalog?.solution.tiers ?? []).map(tier => ({ label: `${tier.name} · ${t(`vendor.catalog.tiers.${tier.id}`, tier.id)}`, value: tier.id }))" required :disabled="!form.catalog_version" class="w-full" /></UFormField>
          <UFormField :label="t('vendor.tenants.fields.reason')" required><UTextarea v-model="form.reason" required maxlength="1000" class="w-full" /></UFormField>
        </template>
        <div class="flex justify-end gap-2"><UButton :to="backTo" color="neutral" variant="outline">{{ t('app.cancel') }}</UButton><UButton type="submit" icon="i-lucide-plus" :loading="busy" :disabled="!hydrated || busy || (sharedEnabled && (!canSubscribe || !selectedCadence))">{{ t('vendor.tenants.new') }}</UButton></div>
      </form>
    </SharedPageState>
  </SharedCreatePanel>
</template>
