<script setup lang="ts">
import type { PackageInput, PackageRevision } from '@nasq/commercial-contracts'
import { packageListReturnTo, type PackageCatalog } from '@/utils/vendorPackages'
definePageMeta({ middleware: 'vendor', vendorCapability: 'vendor.catalog.manage' })
const { t } = useI18n(); const route = useRoute(); const { request } = useVendorApi(); const { can } = useVendorContext()
const id = computed(() => String(route.params.id)); const listTo = computed(() => packageListReturnTo(route.query.returnTo))
const backTo = computed(() => ({ path: `/vendor/catalog/${encodeURIComponent(id.value)}`, query: { returnTo: listTo.value } }))
const { data, error, pending, refresh } = await useAsyncData(() => `vendor:package-edit:${id.value}`, async () => { const [item, sources] = await Promise.all([request<PackageRevision>(`packages/${encodeURIComponent(id.value)}`), request<{ items: PackageCatalog[] }>('catalog')]); return { item, catalogs: sources.items.filter(source => source.status === 'published') } })
const busy = ref(false); const saveError = ref<unknown>(null); const resetKey = ref(0)
async function save(body: PackageInput) {
  if (busy.value || !data.value || data.value.item.status === 'published' || !can('vendor.catalog.manage')) return
  busy.value = true; saveError.value = null
  try { await request(`packages/${encodeURIComponent(id.value)}`, { method: 'PATCH', body: { ...body, revision: data.value.item.revision } }); resetKey.value++; await nextTick(); await refreshNuxtData(['vendor:packages', `vendor:package:${id.value}`]); await navigateTo(backTo.value) }
  catch (cause) { saveError.value = cause } finally { busy.value = false }
}
</script>
<template><SharedPageContainer width="form"><SharedPageHeader :title="t('vendor.packages.edit')" :back-to="backTo" :back-label="t('vendor.packages.details')" /><SharedPageState :loading="pending" :error="error" @retry="refresh"><template v-if="data"><UAlert v-if="data.item.status === 'published'" color="neutral" variant="subtle" :title="t('vendor.packages.publishedEdit')" /><UAlert v-else-if="!can('vendor.catalog.manage')" color="error" variant="subtle" :title="t('vendor.forbidden')" /><template v-else><UAlert v-if="data.item.status === 'validated'" color="neutral" variant="subtle" :title="t('vendor.packages.editReviewHint')" /><VendorPackageForm :key="data.item.id" :initial="data.item" :catalogs="data.catalogs" :busy="busy" :error="saveError" :reset-key="resetKey" @save="save" @cancel="navigateTo(backTo)" /></template></template></SharedPageState></SharedPageContainer></template>
