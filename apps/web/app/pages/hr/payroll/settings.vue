<script setup lang="ts">
import PayrollCostCenterTable from '@/components/hr/payroll/PayrollCostCenterTable.vue'
import PayrollFinanceSettingsForm from '@/components/hr/payroll/PayrollFinanceSettingsForm.vue'
import GosiRateTable from '@/components/hr/payroll/GosiRateTable.vue'
import PayrollGeneralSettingsForm from '@/components/hr/payroll/PayrollGeneralSettingsForm.vue'
import { saveErrorMessage } from '@/utils/formFeedback'
import { owningListBack } from '@/utils/recordListOrigin'

// The payroll settings of the company: the general pay settings and the GOSI contribution rates (reading is payroll
// access; changing them needs `hr.payroll.config`), then the accounting mapping and the department cost centers. The
// accounting part exists only when the finance bridge answers: a 404 or 403 from its settings route hides it, with no
// guess about installed addons. Changing it needs `finance.setup.manage`, and the cost centers `finance.analytic.manage`.
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()

const sourcePaths = useRecordListPaths(['/hr/payroll'])
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
const canConfig = computed(() => can('hr.payroll.config'))
const settings = useHrPayrollSettings()
const rates = useHrGosiRates()
// The leave pickers need the leave catalog; without leave access they are empty and the rest of the page still works.
const leaveTypes = useHrLeaveTypes()
const leaveTypeRefs = computed(() => (leaveTypes.data.value?.items ?? []).map(type => ({ id: type.id, name: type.name })))
const finance = useHrPayrollFinanceSettings()
const financeSettings = computed(() => finance.data.value)
const canSetup = computed(() => can('finance.setup.manage'))
const canAnalytic = computed(() => can('finance.analytic.manage'))
const lookups = useHrPayrollFinanceLookups({ mapping: () => !!financeSettings.value && canSetup.value, analytic: () => !!financeSettings.value && (canSetup.value || canAnalytic.value) })
const centers = useHrPayrollCostCenters(() => !!financeSettings.value)
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
const error = computed(() => settings.error.value ?? rates.error.value)
function retry() {
  void settings.refetch()
  void rates.refetch()
}
</script>

<template>
  <SharedSettingsPage width="list">
    <SharedPageHeader :title="t('hrPayroll.settings.title')" :back-to="backTo" :back-label="t('hrPayroll.title')" />
    <SharedPageState :loading="settings.isLoading.value || rates.isLoading.value" :error="error" :empty="!settings.data.value" @retry="retry">
      <PayrollGeneralSettingsForm v-if="settings.data.value" :settings="settings.data.value" :leave-types="leaveTypeRefs" :can-edit="canConfig" />
      <GosiRateTable :rates="rates.data.value?.items ?? []" :can-edit="canConfig" />
      <PayrollFinanceSettingsForm
        v-if="financeSettings"
        :settings="financeSettings"
        :can-edit="canSetup"
        :journals="lookups.journals.data.value?.items.filter(journal => journal.type === 'general') ?? null"
        :accounts="lookups.accounts.data.value?.items ?? null"
        :analytic-accounts="lookups.analyticAccounts.data.value?.items ?? null"
      />
      <SharedFormSection v-if="financeSettings && centers.data.value" panel :title="t('hrPayroll.costCenters.title')" :description="t('hrPayroll.costCenters.hint')">
        <UAlert v-if="centerFailureMessage" role="alert" color="error" variant="subtle" :title="t('hrPayroll.costCenters.saveError')" :description="centerFailureMessage" />
        <PayrollCostCenterTable
          :centers="centers.data.value.items"
          :analytic-accounts="lookups.analyticAccounts.data.value?.items ?? null"
          :can-edit="canAnalytic"
          :saving="savingCenters"
          @change="changeCenter"
        />
      </SharedFormSection>
    </SharedPageState>
  </SharedSettingsPage>
</template>
