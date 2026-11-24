<script setup lang="ts">
import type { CatalogRelease } from '@liwan/commercial-contracts'
import { bundleCreatePayload, commercialErrorKey, commercialReturnTo, type BundleDraft, type BundleView } from '@/utils/vendorCommercial'
import { publishedVersions } from '@/utils/vendorCatalogVersions'
import { useVendorCommercial } from '@/composables/useVendorCommercial'
import { useVendorCatalogVersions } from '@/composables/useVendorCatalogVersions'
definePageMeta({ capability: 'vendor.catalog.manage' })
const { t } = useI18n(); const route = useRoute(); const { can } = useVendorContext(); const api = useVendorCommercial(); const hydrated = useHydrated()
const backTo = computed(() => commercialReturnTo(route.query.returnTo, '/bundles'))
const { data, error, pending, refresh } = await useAsyncData('vendor:bundle-releases', () => api.releases())
const releases = computed(() => (data.value ?? []) as CatalogRelease[])
const { data: versions, error: versionsError, pending: versionsPending, refresh: refreshVersions } = await useVendorCatalogVersions().load()
const published = computed(() => publishedVersions(versions.value ?? []))
const versionItems = computed(() => published.value.map(item => ({ label: item.version, value: item.version })))
const busy = ref(false); const saveError = ref<unknown>(null); const resetKey = ref(0)
const relReason = ref(''); const relVersion = ref<string | undefined>(); const relAttempted = ref(false); const relBusy = ref(false); const relError = ref<unknown>(null)
watch(published, list => { if (list.length === 1 && !relVersion.value) relVersion.value = list[0]!.version }, { immediate: true })
const retry = () => Promise.all([refresh(), refreshVersions()])
async function save(draft: BundleDraft, release: CatalogRelease | undefined) {
  if (busy.value || !can('vendor.catalog.manage')) return
  busy.value = true; saveError.value = null
  try {
    const item = await api.create<BundleView>('bundle', bundleCreatePayload(draft, release))
    resetKey.value++; await nextTick(); await refreshNuxtData()
    await navigateTo({ path: `/bundles/${item.id}`, query: { returnTo: backTo.value } })
  } catch (cause) { saveError.value = cause } finally { busy.value = false }
}
async function createRelease() {
  relAttempted.value = true
  if (!hydrated.value || relBusy.value || relReason.value.trim().length < 3 || !relVersion.value) return
  relBusy.value = true; relError.value = null
  try { await api.createRelease({ catalog_version: relVersion.value, reason: relReason.value.trim() }); await refresh() } catch (cause) { relError.value = cause } finally { relBusy.value = false }
}
</script>
<template>
  <SharedCreatePanel :title="t('vendor.bundles.create')" :back-to="backTo">
    <SharedPageState :loading="pending || versionsPending" :error="error ?? versionsError" @retry="retry">
      <p v-if="!can('vendor.catalog.manage')">{{ t('vendor.forbidden') }}</p>
      <form v-else-if="!releases.length && published.length" class="space-y-(--liwan-gap-card)" novalidate data-testid="release-create" @submit.prevent="createRelease">
        <div class="space-y-2">
          <h2 class="text-lg font-semibold text-highlighted">{{ t('vendor.bundles.guide.title') }}</h2>
          <p class="text-sm leading-6 text-muted">{{ t('vendor.bundles.guide.why') }}</p>
        </div>
        <ol class="grid gap-2 text-sm sm:grid-cols-2" :aria-label="t('vendor.bundles.guide.steps')">
          <li class="flex items-center gap-3 rounded-control p-3 ring ring-primary" aria-current="step"><UBadge color="primary" variant="solid">1</UBadge><span class="font-medium">{{ t('vendor.bundles.guide.step1') }}</span></li>
          <li class="flex items-center gap-3 rounded-control p-3 ring ring-default text-muted"><UBadge color="neutral" variant="outline">2</UBadge><span>{{ t('vendor.bundles.guide.step2') }}</span></li>
        </ol>
        <UAlert v-if="relError" color="error" variant="subtle" :title="t(commercialErrorKey(relError))" />
        <UFormField :label="t('vendor.pricing.fields.catalogVersion')" required :error="relAttempted && !relVersion ? t('vendor.pricing.required') : undefined"><USelect v-model="relVersion" :items="versionItems" :placeholder="t('vendor.pricing.choose')" class="w-full" data-testid="release-version" :disabled="!hydrated || relBusy" /></UFormField>
        <UFormField :label="t('vendor.pricing.fields.reason')" required :error="relAttempted && relReason.trim().length < 3 ? t('vendor.pricing.reasonRequired') : undefined"><UTextarea v-model="relReason" maxlength="1000" class="w-full" :disabled="!hydrated || relBusy" /></UFormField>
        <div class="flex justify-end"><UButton type="submit" :loading="relBusy" :disabled="!hydrated || relBusy">{{ t('vendor.bundles.createRelease') }}</UButton></div>
      </form>
      <UAlert v-else-if="!releases.length" color="neutral" variant="subtle" :title="t('vendor.bundles.noPublishedCatalog')" :description="t('vendor.bundles.noPublishedCatalogHint')" data-testid="no-published-catalog">
        <template #actions><UButton to="/catalog" color="neutral" variant="outline" size="sm">{{ t('vendor.bundles.openCatalog') }}</UButton></template>
      </UAlert>
      <VendorBundleForm v-else :releases="releases" :busy="busy" :error="saveError" :reset-key="resetKey" :can-price="can('vendor.pricing.manage')" @save="save" @cancel="navigateTo(backTo)" />
    </SharedPageState>
  </SharedCreatePanel>
</template>
