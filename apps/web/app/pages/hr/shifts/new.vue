<script setup lang="ts">
import { owningListBack } from '@/utils/recordListOrigin'
import ShiftAssignmentForm from '@/components/hr/shifts/ShiftAssignmentForm.vue'
import { useHrShiftSchedules } from '@/composables/useHrShifts'

const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const sourcePaths = useRecordListPaths(['/hr/shifts'])
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
const schedules = useHrShiftSchedules({ active: 'true', limit: 200, offset: 0 })
const scheduleOptions = computed(() => (schedules.data.value?.items ?? []).map(schedule => ({ value: String(schedule.id), label: schedule.name })))
const loading = computed(() => schedules.isLoading.value)
const error = computed(() => schedules.error.value)

function saved() {
  void navigateTo(backTo.value, { replace: true })
}
</script>

<template>
  <SharedCreatePanel :title="t('hrShifts.new')" :back-to="backTo">
    <SharedForbiddenState v-if="!can('hr.shifts.manage')" />
    <SharedPageState v-else :loading="loading" :error="error" @retry="schedules.refetch()">
      <ShiftAssignmentForm :back-to="backTo" :schedules="scheduleOptions" @saved="saved" />
    </SharedPageState>
  </SharedCreatePanel>
</template>
