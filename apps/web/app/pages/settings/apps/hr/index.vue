<script setup lang="ts">
import LeaveSettingsForm from '@/components/hr/LeaveSettingsForm.vue'
import ShiftSettingsForm from '@/components/hr/shifts/ShiftSettingsForm.vue'
import EosCaseMapTable from '@/components/hr/payroll/EosCaseMapTable.vue'
import PayrollCostCenterTable from '@/components/hr/payroll/PayrollCostCenterTable.vue'
import PayrollFinanceSettingsForm from '@/components/hr/payroll/PayrollFinanceSettingsForm.vue'
import BankProfileForm from '@/components/hr/payroll/BankProfileForm.vue'
import GosiRateTable from '@/components/hr/payroll/GosiRateTable.vue'
import PayrollGeneralSettingsForm from '@/components/hr/payroll/PayrollGeneralSettingsForm.vue'
import { ApiError } from '@/composables/useApi'
import { isTruncated } from '@/utils/payrollFinanceSettings'
import type { HrEosCase } from '@webvue/contracts'
import { saveErrorMessage } from '@/utils/formFeedback'

// The HR application's settings, one page of cards under Settings > Applications. Payroll is its first card: the general pay settings and the GOSI contribution rates (reading is payroll
// access; changing them needs `hr.payroll.config`), then the accounting mapping and the department cost centers. The
// accounting part exists only when the finance bridge answers: a 404 or 403 from its settings route hides it, with no
// guess about installed addons. Changing it needs `finance.setup.manage`, and the cost centers `finance.analytic.manage`.
const { t } = useI18n()
const { can } = useAccess()
const { parts, shows } = useSettingsPage('hr')
const leaveSettings = useHrLeaveSettings(() => shows('leave'))
async function reloadLeaveSettings() {
  const response = await leaveSettings.refetch({ throwOnError: true })
  if (!response.data) throw new Error(t('errors.generic'))
  return response.data
}
const canConfigLeave = computed(() => can('hr.leave.config'))
const shiftSettings = useHrShiftSettings(() => shows('shifts'))
async function reloadShiftSettings() {
  const result = await shiftSettings.refetch()
  if (result.isError) throw result.error
  if (!result.data) throw new Error('Shift settings are unavailable')
  return result.data
}
const canManageShifts = computed(() => can('hr.shifts.manage'))
const canConfig = computed(() => can('hr.payroll.config'))
const settings = useHrPayrollSettings()
const rates = useHrGosiRates()
const bankProfiles = useHrBankProfiles(() => shows('payroll') && can('hr.payroll.read'))
// The leave pickers need the leave catalog; without leave access they are empty and the rest of the page still works.
const leaveTypes = useHrLeaveTypes(() => shows('payroll') && can('hr.leave.read'))
const leaveTypeRefs = computed(() => (leaveTypes.data.value?.items ?? []).map(type => ({ id: type.id, name: type.name })))
const finance = useHrPayrollFinanceSettings()
const financeSettings = computed(() => finance.data.value)
// A refusal (403) or a missing bridge (404) hides the finance part; any other failure is shown with a retry.
const financeError = computed(() => {
  const failure = finance.error.value
  return failure instanceof ApiError && (failure.status === 403 || failure.status === 404) ? null : failure
})
const canSetup = computed(() => can('finance.setup.manage'))
const canAnalytic = computed(() => can('finance.analytic.manage'))
const lookups = useHrPayrollFinanceLookups({ mapping: () => shows('payroll') && !!financeSettings.value && canSetup.value, analytic: () => shows('payroll') && !!financeSettings.value && (canSetup.value || canAnalytic.value) })
const truncated = computed(() => [lookups.accounts, lookups.journals, lookups.analyticAccounts].some(lookup => isTruncated(lookup.data.value)))
const centers = useHrPayrollCostCenters(() => shows('payroll') && !!financeSettings.value)
const setCenter = useSetHrPayrollCostCenter()
const savingCenters = ref<number[]>([])
const centerFailure = ref<unknown>(null)
async function changeCenter(payload: { departmentId: number; analyticAccountId: number | null }) {
  centerFailure.value = null
  savingCenters.value = [...savingCenters.value, payload.departmentId]
  try { await setCenter.mutateAsync(payload) } catch (failure) { centerFailure.value = failure } finally {
    savingCenters.value = savingCenters.value.filter(id => id !== payload.departmentId)
  }
}
const centerFailureMessage = computed(() => centerFailure.value ? saveErrorMessage(centerFailure.value, t('errors.generic'), t('errors.saveUncertain')) : '')
// The end-of-service case of each departure reason: a choice saves at once and only its row waits.
const eosCases = useHrEosCases()
const saveEosCase = useSaveHrEosCase()
const savingReasons = ref<number[]>([])
const eosFailure = ref<unknown>(null)
async function changeEosCase(payload: { departureReasonId: number; case: HrEosCase }) {
  eosFailure.value = null
  savingReasons.value = [...savingReasons.value, payload.departureReasonId]
  try { await saveEosCase.mutateAsync({ departure_reason_id: payload.departureReasonId, case: payload.case }) } catch (failure) { eosFailure.value = failure } finally {
    savingReasons.value = savingReasons.value.filter(id => id !== payload.departureReasonId)
  }
}
const eosFailureMessage = computed(() => eosFailure.value ? saveErrorMessage(eosFailure.value, t('errors.generic'), t('errors.saveUncertain')) : '')
const error = computed(() => settings.error.value ?? rates.error.value ?? bankProfiles.error.value ?? eosCases.error.value)
function retry() {
  void settings.refetch()
  void rates.refetch()
  void bankProfiles.refetch()
  void eosCases.refetch()
}
</script>

<template>
  <SharedSettingsPage width="list">
    <SharedPageHeader :title="t('nav.hr')" />
    <SharedForbiddenState v-if="!parts.length" :description="t('errors.forbidden')" />
    <template v-else>
    <section v-if="shows('payroll')" id="payroll" class="webvue-settings-anchor grid gap-(--webvue-gap-card)">
    <SharedPageState :loading="settings.isLoading.value || rates.isLoading.value || bankProfiles.isLoading.value || eosCases.isLoading.value" :error="error" :empty="!settings.data.value" @retry="retry">
      <PayrollGeneralSettingsForm v-if="settings.data.value" :settings="settings.data.value" :leave-types="leaveTypeRefs" :can-edit="canConfig" />
      <GosiRateTable :rates="rates.data.value?.items ?? []" :can-edit="canConfig" />
      <BankProfileForm :profiles="bankProfiles.data.value?.items ?? []" :can-edit="canConfig" />
      <SharedFormSection panel :title="t('hrPayroll.eosCases.title')" :description="t('hrPayroll.eosCases.hint')">
        <UAlert v-if="eosFailureMessage" role="alert" color="error" variant="subtle" :title="t('hrPayroll.eosCases.saveError')" :description="eosFailureMessage" />
        <EosCaseMapTable :mappings="eosCases.data.value?.items ?? []" :can-edit="canConfig" :saving="savingReasons" @change="changeEosCase" />
      </SharedFormSection>
      <SharedPageState v-if="financeError" :error="financeError" @retry="finance.refetch" />
      <PayrollFinanceSettingsForm
        v-if="financeSettings"
        :settings="financeSettings"
        :can-edit="canSetup"
        :truncated="truncated"
        :journals="lookups.journals.data.value?.items ?? null"
        :accounts="lookups.accounts.data.value?.items ?? null"
        :analytic-accounts="lookups.analyticAccounts.data.value?.items ?? null"
      />
      <SharedFormSection v-if="financeSettings && centers.data.value" panel :title="t('hrPayroll.costCenters.title')" :description="t('hrPayroll.costCenters.hint')">
        <UAlert v-if="centerFailureMessage" role="alert" color="error" variant="subtle" :title="t('hrPayroll.costCenters.saveError')" :description="centerFailureMessage" />
        <PayrollCostCenterTable
          :centers="centers.data.value.items"
          :analytic-accounts="lookups.analyticAccounts.data.value?.items ?? null"
          :truncated="isTruncated(lookups.analyticAccounts.data.value)"
          :can-edit="canAnalytic"
          :saving="savingCenters"
          @change="changeCenter"
        />
      </SharedFormSection>
    </SharedPageState>
    </section>
    <section v-if="shows('leave')" id="leave" class="webvue-settings-anchor">
      <SharedPageState :loading="leaveSettings.isLoading.value" :error="leaveSettings.error.value" :empty="!leaveSettings.data.value" :keep-content="!!leaveSettings.data.value" @retry="leaveSettings.refetch">
        <LeaveSettingsForm v-if="leaveSettings.data.value" :settings="leaveSettings.data.value" :can-edit="canConfigLeave" :reload-settings="reloadLeaveSettings" />
      </SharedPageState>
    </section>
    <section v-if="shows('shifts')" id="shifts" class="webvue-settings-anchor">
      <SharedPageState :loading="shiftSettings.isLoading.value" :error="shiftSettings.data.value ? null : shiftSettings.error.value" :empty="!shiftSettings.data.value" @retry="shiftSettings.refetch">
        <ShiftSettingsForm v-if="shiftSettings.data.value" :settings="shiftSettings.data.value" :can-edit="canManageShifts" :reload-settings="reloadShiftSettings" />
      </SharedPageState>
    </section>
    </template>
  </SharedSettingsPage>
</template>
