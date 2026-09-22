<script setup lang="ts">
import { safeReturnTo } from '@/utils/safeReturnTo'
definePageMeta({ middleware: 'vendor', vendorCapability: 'vendor.tenants.manage' })
const { t } = useI18n(); const route = useRoute(); const router = useRouter(); const { request } = useVendorApi(); const { can } = useVendorContext()
const { data: targets, pending, error, refresh } = await useAsyncData('vendor:targets', () => request<{ items: { id: string; kind: string }[]; total: number }>('targets'))
const { data: catalog, error: catalogError, refresh: refreshCatalog } = await useAsyncData('vendor:catalog-published', () => request<{ items: { id: string; version: string; status: string; solution: { tiers?: { id: string; name: string }[] } }[]; total: number }>('catalog'))
const published = computed(() => catalog.value?.items.filter(item => item.status === 'published') ?? [])
const selectedCatalog = computed(() => published.value.find(item => item.version === form.catalog_version))
const form = reactive({ name: '', commercial_mode: 'saas', hosting_model: 'managed', inventory_target: '', catalog_version: '', catalog_tier: '', reason: '' })
const busy = ref(false); const saveError = ref<unknown>(null)
const submitted = ref(false)
const dirty = computed(() => !submitted.value && Boolean(form.name.trim() || form.inventory_target || form.catalog_version || form.catalog_tier || form.reason.trim() || form.commercial_mode !== 'saas' || form.hosting_model !== 'managed'))
function fieldError(error: unknown): string {
  const value = error as { data?: { field?: unknown; data?: { field?: unknown } }; field?: unknown; response?: { _data?: { field?: unknown } } } | null
  const field = value?.data?.field ?? value?.data?.data?.field ?? value?.response?._data?.field ?? value?.field
  return typeof field === 'string' ? `vendor.errors.field.${field}` : 'vendor.errors.save'
}
watch(() => form.catalog_version, () => { form.catalog_tier = '' })
async function submit() { if (!can('vendor.tenants.manage') || busy.value) return; busy.value = true; saveError.value = null; try { const result = await request<{ id: string }>('tenants', { method: 'POST', body: { ...form } }); submitted.value = true; await navigateTo(`/vendor/tenants/${result.id}`) } catch (cause) { saveError.value = cause } finally { busy.value = false } }
const backTo = computed(() => safeReturnTo(route.query.returnTo, '/vendor/tenants', ['/vendor/tenants']))
</script>
<template>
  <SharedCreatePanel :title="t('vendor.tenants.create')" :back-to="backTo" width="wide">
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedPageState v-if="!can('vendor.tenants.manage')" :empty="true" :empty-text="t('vendor.forbidden')" />
    <SharedPageState v-else :loading="pending || !catalog" :error="targets && catalog ? null : error || catalogError" @retry="async () => { await refresh(); await refreshCatalog() }">
      <form v-if="targets && catalog" class="grid max-w-2xl gap-5" @submit.prevent="submit">
        <UAlert v-if="saveError" color="error" variant="subtle" :title="t(fieldError(saveError))" />
        <UAlert v-if="!published.length" color="neutral" variant="subtle" :title="t('vendor.tenants.noPublishedCatalog')" />
        <UFormField :label="t('vendor.tenants.fields.name')" required><UInput v-model="form.name" required maxlength="200" class="w-full" /></UFormField>
        <UFormField :label="t('vendor.tenants.fields.mode')" required><USelect v-model="form.commercial_mode" :items="[{ label: t('vendor.mode.saas'), value: 'saas' }, { label: t('vendor.mode.nonSaas'), value: 'non_saas' }]" class="w-full" /></UFormField>
        <UFormField :label="t('vendor.tenants.fields.hosting')" required><USelect v-model="form.hosting_model" :items="[{ label: t('vendor.hosting.managed'), value: 'managed' }, { label: t('vendor.hosting.customerHosted'), value: 'customer_hosted' }]" class="w-full" /></UFormField>
        <UFormField :label="t('vendor.tenants.fields.target')" required :help="t('vendor.tenants.targetHelp')"><USelect v-model="form.inventory_target" :items="targets.items.map(item => ({ label: `${item.id} · ${t(`vendor.targetKind.${item.kind}`)}`, value: item.id }))" required class="w-full" /><p v-if="!targets.items.length" class="mt-1 text-xs text-muted">{{ t('vendor.tenants.noTargets') }}</p></UFormField>
        <UFormField :label="t('vendor.tenants.fields.catalogVersion')" required><USelect v-model="form.catalog_version" :items="published.map(item => ({ label: item.version, value: item.version }))" required class="w-full" /></UFormField>
        <UFormField :label="t('vendor.tenants.fields.catalogTier')" required><USelect v-model="form.catalog_tier" :items="(selectedCatalog?.solution.tiers ?? []).map(tier => ({ label: `${tier.name} · ${t(`vendor.catalog.tiers.${tier.id}`, tier.id)}`, value: tier.id }))" required :disabled="!form.catalog_version" class="w-full" /></UFormField>
        <UFormField :label="t('vendor.tenants.fields.reason')" required><UTextarea v-model="form.reason" required maxlength="1000" class="w-full" /></UFormField>
        <div class="flex justify-end gap-2"><UButton :to="backTo" color="neutral" variant="outline">{{ t('app.cancel') }}</UButton><UButton type="submit" icon="i-lucide-plus" :loading="busy" :disabled="busy || !form.inventory_target || !form.catalog_version || !form.catalog_tier">{{ t('vendor.tenants.new') }}</UButton></div>
      </form>
    </SharedPageState>
  </SharedCreatePanel>
</template>
