<script setup lang="ts">
import { catalogReturn } from '@/utils/vendorCatalog'
import { commercialFailure, planEditPayload, type BundleView, type PlanDraft, type PlanView } from '@/utils/vendorCommercial'
import { useVendorCommercial } from '@/composables/useVendorCommercial'
definePageMeta({ capability: 'vendor.catalog.manage' })
const { t } = useI18n(); const route = useRoute(); const { can } = useVendorContext(); const api = useVendorCommercial()
const id = computed(() => String(route.params.id)); const backTo = computed(() => catalogReturn(route.query.returnTo, 'plans').to)
const allowed = computed(() => can('vendor.catalog.manage') && can('vendor.pricing.manage'))
const { data, error, pending, refresh } = await useAsyncData(() => `vendor:plan-edit:${id.value}`, async () => {
  const view = await api.get<PlanView>('plan', id.value)
  const published = (await api.listBundles({ status: 'published', limit: 100 })).items.filter(b => b.available)
  const known = new Set(published.map(b => b.id))
  const kept = (await Promise.all([...view.included_bundle_revision_ids, ...view.optional_bundle_revision_ids].filter(x => !known.has(x)).map(x => api.get<BundleView>('bundle', x).catch(() => null)))).filter((b): b is BundleView => Boolean(b))
  return { view, bundles: [...published, ...kept], policy: await api.policies() }
})
const busy = ref(false); const saveError = ref<unknown>(null); const resetKey = ref(0)
const readOnly = computed(() => Boolean(data.value && data.value.view.status !== 'draft'))
const detailTo = computed(() => ({ path: `/plans/${id.value}`, query: { returnTo: backTo.value } }))
async function save(draft: PlanDraft) {
  if (busy.value || !data.value || !allowed.value) return
  busy.value = true; saveError.value = null
  try { await api.update<PlanView>('plan', id.value, planEditPayload(draft, data.value.view.policy_revision_id, data.value.view.edit_revision)); resetKey.value++; await nextTick(); await refreshNuxtData(); await navigateTo(detailTo.value) }
  catch (cause) { saveError.value = cause } finally { busy.value = false }
}
</script>
<template>
  <SharedPageContainer width="detail">
    <SharedPageHeader :title="t('vendor.plans.edit')" :back-to="detailTo" :back-label="data?.view.name ?? t('vendor.plans.title')" />
    <SharedPageState :loading="pending" :error="error" :empty="readOnly || !allowed" :empty-text="readOnly ? t('vendor.pricing.notDraft') : t('vendor.pricing.errors.pricingRequired')" @retry="refresh">
      <template v-if="data && !readOnly && allowed">
        <UAlert v-if="saveError && commercialFailure(saveError).conflict" class="mb-4" color="warning" variant="subtle" :title="t('vendor.pricing.errors.revision_conflict')"><template #actions><UButton color="neutral" variant="outline" size="sm" @click="() => refresh()">{{ t('vendor.pricing.reload') }}</UButton></template></UAlert>
        <VendorPlanForm :key="data.view.edit_revision" :bundles="data.bundles" :policy="data.policy" :initial="data.view" :busy="busy" :error="saveError" :reset-key="resetKey" require-reason @save="save" @cancel="navigateTo(detailTo)" />
      </template>
    </SharedPageState>
  </SharedPageContainer>
</template>
