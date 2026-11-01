<script setup lang="ts">
definePageMeta({ path: '/account/schedule' })
import ShiftAssignmentTable from '@/components/hr/shifts/ShiftAssignmentTable.vue'
import ShiftWeekGrid from '@/components/hr/shifts/ShiftWeekGrid.vue'
import { weekStartOf } from '@/components/hr/shifts/shiftWeek'
const { t } = useI18n()
const profile = useMyHrProfile()
const assignments = useMyHrShiftAssignments(computed(() => !!profile.data.value))
const week = useMyHrShiftWeek(weekStartOf(new Date().toISOString().slice(0, 10)), computed(() => !!profile.data.value))
const weeks = computed(() => (week.data.value ? [week.data.value] : []))
const items = computed(() => assignments.data.value?.items ?? [])
</script>

<template>
  <SharedListPage :title="t('hr.self.schedule')">
    <SharedPageState :loading="profile.isLoading.value" :error="profile.error.value" @retry="profile.refetch">
      <SharedEmptyState v-if="profile.data.value === null" bordered :title="t('hr.self.noEmployee')" :description="t('hr.self.noEmployeeHint')" />
    </SharedPageState>
    <SharedListCard v-if="profile.data.value">
      <SharedPageState :loading="week.isLoading.value" :error="week.error.value" @retry="week.refetch">
        <ShiftWeekGrid v-if="weeks.length" :weeks="weeks" :caption="t('hrShifts.myWeek')" :show-employee="false" />
      </SharedPageState>
    </SharedListCard>
    <SharedListCard v-if="profile.data.value">
      <SharedPageState :loading="assignments.isLoading.value" :error="assignments.error.value" @retry="assignments.refetch">
        <SharedEmptyState v-if="!items.length" class="m-(--liwan-card-pad-dense)" :title="t('hrShifts.emptyMine')" :description="t('hrShifts.emptyMineHint')" />
        <ShiftAssignmentTable v-else :assignments="items" :caption="t('hr.self.schedule')" />
      </SharedPageState>
    </SharedListCard>
  </SharedListPage>
</template>
