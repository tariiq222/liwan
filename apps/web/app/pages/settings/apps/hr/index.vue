<script setup lang="ts">
import LeaveSettingsForm from '@/components/hr/LeaveSettingsForm.vue'
import ShiftSettingsForm from '@/components/hr/shifts/ShiftSettingsForm.vue'
import EosCaseMapTable from '@/components/hr/payroll/EosCaseMapTable.vue'
import BranchStrictCard from '@/components/access/branches/BranchStrictCard.vue'
import PayrollCostCenterTable from '@/components/hr/payroll/PayrollCostCenterTable.vue'
import PayrollFinanceSettingsForm from '@/components/hr/payroll/PayrollFinanceSettingsForm.vue'
import BankProfileForm from '@/components/hr/payroll/BankProfileForm.vue'
import GosiRateTable from '@/components/hr/payroll/GosiRateTable.vue'
import PayrollGeneralSettingsForm from '@/components/hr/payroll/PayrollGeneralSettingsForm.vue'
import { ApiError } from '@/composables/useApi'
import { isTruncated } from '@/utils/payrollFinanceSettings'
import type { HrEosCase } from '@webvue/contracts'
import { saveErrorMessage } from '@/utils/formFeedback'
import { isPayrollConflict } from '@/utils/payrollErrors'

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
// The explicit reload after a 409: the form gets the latest rows or the refetch's failure, never stale cached data.
async function refetched<T>(query: { refetch: () => Promise<{ isError: boolean; error: unknown; data: T | undefined }> }): Promise<T> {
  const result = await query.refetch()
  if (result.isError) throw result.error
  if (result.data === undefined) throw new Error(t('errors.generic'))
  return result.data
}
const reloadPayrollSettings = () => refetched(settings)
const reloadRates = async () => (await refetched(rates)).items
const reloadBankProfiles = async () => (await refetched(bankProfiles)).items
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
// The end-of-service case of each departure reason: a choice saves at once with the row's revision and only its row
// waits. A stale choice (409) stays shown as a draft and locks the table until the mappings are reloaded.
const eosCases = useHrEosCases()
const saveEosCase = useSaveHrEosCase()
const savingReasons = ref<number[]>([])
const eosDrafts = ref<Partial<Record<number, HrEosCase>>>({})
const { failure: eosFailure, conflict: eosConflict, reloading: eosReloading, reloadFailure: eosReloadFailure, reload: reloadEosCases } = usePayrollConflict(
  () => refetched(eosCases), () => { eosDrafts.value = {} },
)
async function changeEosCase(payload: { departureReasonId: number; case: HrEosCase; revision: number }) {
  eosFailure.value = null
  eosDrafts.value = { ...eosDrafts.value, [payload.departureReasonId]: payload.case }
  savingReasons.value = [...savingReasons.value, payload.departureReasonId]
  try {
    await saveEosCase.mutateAsync({ departure_reason_id: payload.departureReasonId, case: payload.case, revision: payload.revision })
    const { [payload.departureReasonId]: _saved, ...rest } = eosDrafts.value
    eosDrafts.value = rest
  } catch (failure) {
    eosFailure.value = failure
    if (!isPayrollConflict(failure)) {
      const { [payload.departureReasonId]: _refused, ...rest } = eosDrafts.value
      eosDrafts.value = rest
    }
  } finally {
    savingReasons.value = savingReasons.value.filter(id => id !== payload.departureReasonId)
  }
}
const eosFailureMessage = computed(() => {
  if (eosConflict.value) return t('hrPayroll.revision.conflict')
  return eosFailure.value ? saveErrorMessage(eosFailure.value, t('errors.generic'), t('errors.saveUncertain')) : ''
})
// Only a query that never loaded fails the card, like the shift settings below. A failed refetch of loaded data (a
// reload after a 409 included) must not switch the card to its error state: that would remount the editors and drop
// the draft, its conflict and the reload error the form shows itself.
const error = computed(() => [settings, rates, bankProfiles, eosCases].map(query => query.data.value ? null : query.error.value).find(Boolean) ?? null)
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
      <PayrollGeneralSettingsForm v-if="settings.data.value" :settings="settings.data.value" :leave-types="leaveTypeRefs" :can-edit="canConfig" :reload-settings="reloadPayrollSettings" />
      <BranchStrictCard scope="payroll" path="/api/v1/hr/payroll/branch-strictness" :can-read="can('hr.payroll.read')" :can-edit="canConfig" />
      <GosiRateTable :rates="rates.data.value?.items ?? []" :can-edit="canConfig" :reload-rates="reloadRates" />
      <BankProfileForm :profiles="bankProfiles.data.value?.items ?? []" :can-edit="canConfig" :reload-profiles="reloadBankProfiles" />
      <SharedFormSection panel :title="t('hrPayroll.eosCases.title')" :description="t('hrPayroll.eosCases.hint')">
        <UAlert v-if="eosFailureMessage" role="alert" color="error" variant="subtle" :title="t('hrPayroll.eosCases.saveError')" :description="eosFailureMessage" />
        <UButton v-if="eosConflict" color="neutral" variant="outline" :label="t('hrPayroll.revision.reload')" :loading="eosReloading" :disabled="eosReloading" data-testid="hr-eos-cases-reload" @click="reloadEosCases" />
        <UAlert v-if="eosReloadFailure" role="alert" color="error" variant="subtle" :title="t('hrPayroll.revision.reloadError')" />
        <EosCaseMapTable :mappings="eosCases.data.value?.items ?? []" :can-edit="canConfig" :saving="savingReasons" :drafts="eosDrafts" :locked="eosConflict || eosReloading" @change="changeEosCase" />
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
    <section v-if="shows('branch-access')" id="branch-access" class="webvue-settings-anchor">
      <BranchStrictCard scope="hr" path="/api/v1/hr/branch-strictness" :can-read="can('hr.employees.manage')" :can-edit="can('hr.employees.manage')" />
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
