<script setup lang="ts">
import RunSteps from '@/components/hr/lifecycle/RunSteps.vue'
import DepartureForm from '@/components/hr/lifecycle/DepartureForm.vue'
import EosSettlementSection from '@/components/hr/payroll/EosSettlementSection.vue'
import { useCompleteHrOffboardingStep, useHrDeparture, useHrOffboardingRun } from '@/composables/useHrOffboarding'
import { ApiError } from '@/composables/useApi'
import { payrollErrorMessage } from '@/utils/payrollErrors'
import type { HrEosCase, HrSettlementWrite } from '@webvue/contracts'

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

// The end-of-service settlement is payroll data: it is neither fetched nor shown without `hr.payroll.read` (which
// carries the `hr.payroll` sub-feature gate). Until a settlement is saved the section shows the server's estimate for the
// departure date; the case the user picks (or the departure reason maps to) drives it.
const canReadPayroll = computed(() => can('hr.payroll.read'))
const settlementQuery = useHrSettlement(computed(() => validId.value ? employeeId.value : 0))
const settlement = computed(() => settlementQuery.data.value ?? null)
const chosenCase = ref<HrEosCase | null>(null)
const estimateParams = computed(() => departure.value && settlementQuery.data.value === null
  ? { date: departure.value.departure_date, case: chosenCase.value ?? undefined }
  : null)
const estimate = useHrEosEstimate(computed(() => validId.value ? employeeId.value : 0), estimateParams)
const eosCase = computed<HrEosCase | null>({
  get: () => chosenCase.value ?? settlement.value?.case ?? estimate.data.value?.case ?? null,
  set: (value) => { chosenCase.value = value },
})
const saveSettlement = useSaveHrSettlement(computed(() => employeeId.value))
const confirmSettlement = useConfirmHrSettlement(computed(() => employeeId.value))
const eosFailure = ref<unknown>(null)
// Confirming one's own settlement is refused with `transition_forbidden`: say that, not the payroll-run wording.
const eosConfirmRefused = ref(false)
const eosError = computed(() => {
  const failure = eosFailure.value ?? settlementQuery.error.value ?? estimate.error.value
  if (!failure) return ''
  if (eosConfirmRefused.value && failure instanceof ApiError && failure.code === 'transition_forbidden') {
    // Only the own-record refusal names the employee; any other one means the settlement is already confirmed.
    return t(failure.details?.employee_id !== undefined ? 'hrPayroll.eos.ownRecordForbidden' : 'hrPayroll.eos.alreadyConfirmed')
  }
  return payrollErrorMessage(failure, t, new Map())
})
async function saveEos(body: HrSettlementWrite) {
  eosFailure.value = null
  eosConfirmRefused.value = false
  try { await saveSettlement.mutateAsync(body) } catch (error) { eosFailure.value = error }
}
async function confirmEos() {
  eosFailure.value = null
  eosConfirmRefused.value = true
  try { await confirmSettlement.mutateAsync() } catch (error) {
    eosFailure.value = error
    if (error instanceof ApiError && error.code === 'transition_forbidden' && error.details?.employee_id === undefined) void settlementQuery.refetch()
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
    />
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
    <EosSettlementSection
      v-if="departure && canReadPayroll && settlementQuery.data.value !== undefined"
      v-model:case="eosCase"
      :settlement="settlement"
      :estimate="estimate.data.value ?? null"
      :estimate-loading="estimate.isLoading.value"
      :can-manage="can('hr.payroll.manage')"
      :can-approve="can('hr.payroll.approve')"
      :saving="saveSettlement.isPending.value"
      :confirming="confirmSettlement.isPending.value"
      :error="eosError"
      @save="saveEos"
      @confirm="confirmEos"
    />
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
