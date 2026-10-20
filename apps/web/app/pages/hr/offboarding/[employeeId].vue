<script setup lang="ts">
import RunSteps from '@/components/hr/lifecycle/RunSteps.vue'
import DepartureForm from '@/components/hr/lifecycle/DepartureForm.vue'
import { useCompleteHrOffboardingStep, useHrDeparture, useHrOffboardingRun } from '@/composables/useHrOffboarding'
import { ApiError } from '@/composables/useApi'

const NAMESPACE = 'hrOffboarding'
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const employeeId = computed(() => Number(route.params.employeeId))
const validId = computed(() => Number.isSafeInteger(employeeId.value) && employeeId.value > 0)
const query = useHrDeparture(computed(() => validId.value ? employeeId.value : null))
const departure = computed(() => query.data.value)
const pageError = computed(() => query.error.value ?? (validId.value ? null : new ApiError(404, 'not_found', t(`${NAMESPACE}.errors.notFound`))))
const backTo = computed(() => typeof route.query.returnTo === 'string' && route.query.returnTo.startsWith('/') ? route.query.returnTo : '/hr/offboarding')
const clearanceId = computed(() => departure.value?.clearance.run_id ?? null)
const clearance = useHrOffboardingRun(clearanceId)
const cleared = computed(() => {
  const value = departure.value?.clearance
  return !!value && value.total > 0 && value.done === value.total
})
// Open custody: equipment still assigned to the employee who is leaving.
const custody = useHrEquipmentList(computed(() => ({ employeeId: validId.value ? employeeId.value : null, limit: 1 })), validId)
const heldAssets = computed(() => custody.data.value?.total ?? 0)
const stepError = ref<unknown>(null)
const { mutateAsync: completeStep, isPending } = useCompleteHrOffboardingStep()
async function complete(stepId: number, feedback?: string) {
  if (!clearanceId.value || isPending.value) return
  try {
    await completeStep({ runId: clearanceId.value, stepId, feedback })
    stepError.value = null
  } catch (error) {
    stepError.value = error
  }
}
</script>

<template>
  <SharedRecordPage
    :keep-content="!!departure"
    :title="departure?.employee.name || t(`${NAMESPACE}.departures.title`)"
    :back-to="backTo"
    :loading="query.isLoading.value"
    :error="pageError"
    @retry="query.refetch"
  >
    <template v-if="departure && can('hr.assets.read')" #actions>
      <UButton
        color="neutral"
        variant="outline"
        icon="i-lucide-package"
        :to="{ path: '/hr/assets', query: { employee_id: String(departure.employee.id) } }"
        :label="t(`${NAMESPACE}.departures.assetsLink`)"
      />
    </template>
    <UAlert
      v-if="departure && can('hr.assets.read') && heldAssets > 0"
      role="status"
      color="warning"
      variant="subtle"
      icon="i-lucide-package"
      :title="t(`${NAMESPACE}.departures.heldAssets`, { count: heldAssets }, heldAssets)"
      data-testid="hr-offboarding-held-assets"
    >
      <template #actions>
        <UButton color="neutral" variant="outline" :to="{ path: '/hr/assets', query: { employee_id: String(departure.employee.id) } }" :label="t(`${NAMESPACE}.departures.assetsLink`)" />
      </template>
    </UAlert>
    <SharedIdentityCard v-if="departure" :id="departure.employee.id" :name="departure.employee.name" :subtitle="departure.reason?.name || t(`${NAMESPACE}.departures.noReason`)">
      <template #badge>
        <SharedStatusBadge size="sm" :tone="cleared ? 'success' : 'warning'" :label="cleared ? t(`${NAMESPACE}.departures.cleared`) : t(`${NAMESPACE}.departures.notCleared`)" />
      </template>
    </SharedIdentityCard>
    <SharedRecordSection v-if="departure" :title="t(`${NAMESPACE}.departures.clearance`)">
      <UAlert v-if="stepError" role="alert" color="error" variant="subtle" :title="t(`${NAMESPACE}.form.saveError`)" />
      <SharedPageState v-else-if="!clearanceId" :empty="true" :empty-text="t(`${NAMESPACE}.run.noSteps`)" />
      <RunSteps v-else-if="clearance.data.value" :run="clearance.data.value" :namespace="NAMESPACE" :pending="isPending" @complete="complete" />
    </SharedRecordSection>
    <DepartureForm v-if="departure && can('hr.offboarding.manage')" :namespace="NAMESPACE" :departure="departure" :back-to="backTo" />
    <template v-if="departure" #aside>
      <SharedPropertiesPanel>
        <SharedPropertyRow :label="t(`${NAMESPACE}.departures.date`)" :value="departure.departure_date" />
        <SharedPropertyRow :label="t(`${NAMESPACE}.departures.clearance`)" :value="`${departure.clearance.done} / ${departure.clearance.total}`" />
        <SharedPropertyRow :label="t(`${NAMESPACE}.departures.employee`)" :value="departure.employee.name" />
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
</template>
