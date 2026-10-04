<script setup lang="ts">
import type { PackageInput, PackageRevision } from '@nasq/commercial-contracts'
import { packageListReturnTo, type PackageCatalog } from '@/utils/vendorPackages'
definePageMeta({ middleware: 'vendor', vendorCapability: 'vendor.catalog.manage' })
const { t } = useI18n(); const route = useRoute(); const { request } = useVendorApi(); const { can } = useVendorContext()
const backTo = computed(() => packageListReturnTo(route.query.returnTo))
const { data, error, pending, refresh } = await useAsyncData('vendor:package-sources', () => request<{ items: PackageCatalog[] }>('catalog'))
const catalogs = computed(() => data.value?.items.filter(item => item.status === 'published') ?? [])
const busy = ref(false); const saveError = ref<unknown>(null); const resetKey = ref(0)
async function save(body: PackageInput) {
  if (busy.value || !can('vendor.catalog.manage')) return
  busy.value = true; saveError.value = null
  try { const item = await request<PackageRevision>('packages', { method: 'POST', body }); resetKey.value++; await nextTick(); await refreshNuxtData('vendor:packages'); await navigateTo({ path: `/vendor/catalog/${item.id}`, query: { returnTo: backTo.value } }) }
  catch (cause) { saveError.value = cause } finally { busy.value = false }
}
</script>
<template><SharedCreatePanel :title="t('vendor.packages.create')" :back-to="backTo" width="wide"><SharedPageState :loading="pending" :error="error" :empty="!pending && !error && (!can('vendor.catalog.manage') || !catalogs.length)" :empty-text="t(can('vendor.catalog.manage') ? 'vendor.packages.noSources' : 'vendor.forbidden')" @retry="refresh"><VendorPackageForm v-if="catalogs.length && can('vendor.catalog.manage')" :catalogs="catalogs" :busy="busy" :error="saveError" :reset-key="resetKey" @save="save" @cancel="navigateTo(backTo)" /></SharedPageState></SharedCreatePanel></template>
