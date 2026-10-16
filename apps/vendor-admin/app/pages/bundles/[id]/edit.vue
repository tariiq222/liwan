<script setup lang="ts">
import { catalogReturn } from '@/utils/vendorCatalog'
import { bundleEditPayload, commercialFailure, type BundleDraft, type BundleView } from '@/utils/vendorCommercial'
import { useVendorCommercial } from '@/composables/useVendorCommercial'
import type { CatalogRelease } from '@nasq/commercial-contracts'
definePageMeta({ capability: 'vendor.catalog.manage' })
const { t } = useI18n(); const route = useRoute(); const { can } = useVendorContext(); const api = useVendorCommercial()
const id = computed(() => String(route.params.id)); const backTo = computed(() => catalogReturn(route.query.returnTo, 'bundles').to)
const { data, error, pending, refresh } = await useAsyncData(() => `vendor:bundle-edit:${id.value}`, async () => ({ view: await api.get<BundleView>('bundle', id.value), releases: (await api.releases()) as CatalogRelease[] }))
const busy = ref(false); const saveError = ref<unknown>(null); const resetKey = ref(0)
const readOnly = computed(() => Boolean(data.value && data.value.view.status !== 'draft'))
const detailTo = computed(() => ({ path: `/bundles/${id.value}`, query: { returnTo: backTo.value } }))
async function save(draft: BundleDraft, release: CatalogRelease | undefined) {
  if (busy.value || !data.value || !can('vendor.catalog.manage')) return
  busy.value = true; saveError.value = null
  try { await api.update<BundleView>('bundle', id.value, bundleEditPayload(draft, release, data.value.view.edit_revision)); resetKey.value++; await nextTick(); await refreshNuxtData(); await navigateTo(detailTo.value) }
  catch (cause) { saveError.value = cause } finally { busy.value = false }
}
</script>
<template>
  <SharedPageContainer width="detail">
    <SharedPageHeader :title="t('vendor.bundles.edit')" :back-to="detailTo" :back-label="data?.view.name ?? t('vendor.bundles.title')" />
    <SharedPageState :loading="pending" :error="error" :empty="readOnly" :empty-text="t('vendor.pricing.notDraft')" @retry="refresh">
      <template v-if="data && !readOnly">
        <UAlert v-if="saveError && commercialFailure(saveError).conflict" class="mb-4" color="warning" variant="subtle" :title="t('vendor.pricing.errors.revision_conflict')"><template #actions><UButton color="neutral" variant="outline" size="sm" @click="() => refresh()">{{ t('vendor.pricing.reload') }}</UButton></template></UAlert>
        <VendorBundleForm :key="data.view.edit_revision" :releases="data.releases" :initial="data.view" :busy="busy" :error="saveError" :reset-key="resetKey" require-reason :can-price="can('vendor.pricing.manage')" @save="save" @cancel="navigateTo(detailTo)" />
      </template>
    </SharedPageState>
  </SharedPageContainer>
</template>
