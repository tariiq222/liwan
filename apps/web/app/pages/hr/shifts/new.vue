<script setup lang="ts">
import { owningListBack } from '@/utils/recordListOrigin'
import ShiftAssignmentForm from '@/components/hr/shifts/ShiftAssignmentForm.vue'
import { useHrShiftSchedules } from '@/composables/useHrShifts'
import { useHrEmployees } from '@/composables/useHrEmployees'

const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const sourcePaths = useRecordListPaths(['/hr/shifts'])
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
const employees = useHrEmployees({ limit: 200 })
const schedules = useHrShiftSchedules({ active: 'true', limit: 200, offset: 0 })
const employeeOptions = computed(() => (employees.data.value?.items ?? []).map(employee => ({ value: String(employee.id), label: employee.name })))
const scheduleOptions = computed(() => (schedules.data.value?.items ?? []).map(schedule => ({ value: String(schedule.id), label: schedule.name })))
const loading = computed(() => employees.isLoading.value || schedules.isLoading.value)
const error = computed(() => employees.error.value ?? schedules.error.value)

function saved() {
  void navigateTo(backTo.value, { replace: true })
}
</script>

<template>
  <SharedCreatePanel :title="t('hrShifts.new')" :back-to="backTo">
    <SharedPageState v-if="!can('hr.shifts.manage')" :empty="true" :empty-text="t('errors.forbidden')" />
    <SharedPageState v-else :loading="loading" :error="error" @retry="employees.refetch(); schedules.refetch()">
      <ShiftAssignmentForm :back-to="backTo" :employees="employeeOptions" :schedules="scheduleOptions" @saved="saved" />
    </SharedPageState>
  </SharedCreatePanel>
</template>
