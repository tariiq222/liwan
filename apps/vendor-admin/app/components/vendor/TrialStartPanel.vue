<script setup lang="ts">
import type { PlanView } from '@webvue/commercial-contracts'
import { cadenceLabel } from '@webvue/commercial-ui/app/utils/commercial'
import { cadenceKey, commercialErrorKey, lifecycleStatus } from '@/utils/vendorCommercial'
import { planRequestBody } from '@/utils/vendorTenantPlan'
import { useVendorSubscriptions } from '@/composables/useVendorSubscriptions'
const props = defineProps<{ customerId: string; plans: PlanView[] }>()
const emit = defineEmits<{ done: [] }>()
const { t } = useI18n(); const api = useVendorSubscriptions(); const hydrated = useHydrated()
const trialPlans = computed(() => props.plans.filter(p => p.trial_days > 0 && lifecycleStatus(p) === 'published'))
const planId = ref(''); const cadence = ref('')
const plan = computed(() => trialPlans.value.find(p => p.id === planId.value))
const cadenceItems = computed(() => (plan.value?.prices ?? []).map(p => ({ label: cadenceLabel(p.cadence, t), value: cadenceKey(p.cadence) })))
const selectedCadence = computed(() => plan.value?.prices.find(p => cadenceKey(p.cadence) === cadence.value)?.cadence)
watch(planId, () => { cadence.value = '' })
const busy = ref(false); const failure = ref<string | undefined>()
const blocked = computed(() => !hydrated.value || busy.value || !plan.value || !selectedCadence.value)
async function start() {
  if (blocked.value) return
  busy.value = true; failure.value = undefined
  try { await api.startTrial(props.customerId, planRequestBody(plan.value!, selectedCadence.value!)); emit('done') } catch (cause) { failure.value = t(commercialErrorKey(cause)) } finally { busy.value = false }
}
</script>
<template>
  <SharedRecordSection variant="panel" :title="t('vendor.customers.trialStart.title')" :description="t('vendor.customers.trialStart.hint')">
    <p v-if="!trialPlans.length" class="text-sm text-muted">{{ t('vendor.customers.trialStart.noPlans') }}</p>
    <form v-else class="space-y-4" novalidate @submit.prevent="start">
      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField :label="t('vendor.customers.trialStart.plan')" required><USelect v-model="planId" :items="trialPlans.map(p => ({ label: p.name, value: p.id }))" class="w-full" :disabled="!hydrated || busy" /></UFormField>
        <UFormField :label="t('vendor.customers.trialStart.cadence')" required><USelect v-model="cadence" :items="cadenceItems" class="w-full" :disabled="!hydrated || busy || !plan" /></UFormField>
      </div>
      <UAlert v-if="failure" color="error" variant="subtle" :title="failure" />
      <UButton type="submit" icon="i-lucide-play" :loading="busy" :disabled="blocked">{{ plan ? t('vendor.customers.trialStart.action', { days: plan.trial_days }) : t('vendor.customers.trialStart.title') }}</UButton>
    </form>
  </SharedRecordSection>
</template>
