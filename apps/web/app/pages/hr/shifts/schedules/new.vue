<script setup lang="ts">
import { owningListBack } from '@/utils/recordListOrigin'
import ShiftScheduleForm from '@/components/hr/shifts/ShiftScheduleForm.vue'

const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const sourcePaths = useRecordListPaths(['/hr/shifts/schedules'])
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))

function saved() {
  void navigateTo(backTo.value, { replace: true })
}
</script>

<template>
  <SharedCreatePanel :title="t('hrShifts.newSchedule')" :back-to="backTo">
    <SharedForbiddenState v-if="!can('hr.shifts.manage')" />
    <ShiftScheduleForm v-else :back-to="backTo" @saved="saved" />
  </SharedCreatePanel>
</template>
