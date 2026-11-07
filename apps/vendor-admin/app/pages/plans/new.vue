<script setup lang="ts">
import { commercialReturnTo, planCreatePayload, type PlanDraft, type PlanView } from '@/utils/vendorCommercial'
import { useVendorCommercial } from '@/composables/useVendorCommercial'
definePageMeta({ capability: 'vendor.catalog.manage' })
const { t } = useI18n(); const route = useRoute(); const { can } = useVendorContext(); const api = useVendorCommercial()
const backTo = computed(() => commercialReturnTo(route.query.returnTo, '/plans'))
const allowed = computed(() => can('vendor.catalog.manage') && can('vendor.pricing.manage'))
const { data, error, pending, refresh } = await useAsyncData('vendor:plan-sources', async () => ({
  bundles: (await api.listBundles({ status: 'published', limit: 100 })).items.filter(b => b.available), policies: await api.policies(),
}))
const busy = ref(false); const saveError = ref<unknown>(null); const resetKey = ref(0)
async function save(draft: PlanDraft) {
  if (busy.value || !allowed.value || !draft.policy_revision_id) return
  busy.value = true; saveError.value = null
  try {
    const item = await api.create<PlanView>('plan', planCreatePayload(draft, draft.policy_revision_id))
    resetKey.value++; await nextTick(); await refreshNuxtData()
    await navigateTo({ path: `/plans/${item.id}`, query: { returnTo: backTo.value } })
  } catch (cause) { saveError.value = cause } finally { busy.value = false }
}
</script>
<template>
  <SharedCreatePanel :title="t('vendor.plans.create')" :back-to="backTo">
    <SharedPageState :loading="pending" :error="error" :empty="!pending && !error && !allowed" :empty-text="t('vendor.pricing.errors.pricingRequired')" @retry="refresh">
      <VendorPlanForm v-if="data && allowed" :bundles="data.bundles" :policies="data.policies" :busy="busy" :error="saveError" :reset-key="resetKey" @save="save" @cancel="navigateTo(backTo)" />
    </SharedPageState>
  </SharedCreatePanel>
</template>
