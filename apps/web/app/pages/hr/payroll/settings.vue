<script setup lang="ts">
import GosiRateTable from '@/components/hr/payroll/GosiRateTable.vue'
import PayrollGeneralSettingsForm from '@/components/hr/payroll/PayrollGeneralSettingsForm.vue'
import { owningListBack } from '@/utils/recordListOrigin'

// The payroll settings of the company: the general pay settings and the GOSI contribution rates. Reading is payroll
// access; changing them needs `hr.payroll.config`.
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
    </SharedPageState>
  </SharedSettingsPage>
</template>
