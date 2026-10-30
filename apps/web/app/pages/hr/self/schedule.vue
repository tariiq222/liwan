<script setup lang="ts">
definePageMeta({ path: '/account/schedule' })
import ShiftAssignmentTable from '@/components/hr/shifts/ShiftAssignmentTable.vue'
const { t } = useI18n()
const profile = useMyHrProfile()
const assignments = useMyHrShiftAssignments(computed(() => !!profile.data.value))
const items = computed(() => assignments.data.value?.items ?? [])
</script>

<template>
  <SharedListPage :title="t('hr.self.schedule')">
    <SharedPageState :loading="profile.isLoading.value" :error="profile.error.value" @retry="profile.refetch">
      <SharedEmptyState v-if="profile.data.value === null" bordered :title="t('hr.self.noEmployee')" :description="t('hr.self.noEmployeeHint')" />
    </SharedPageState>
    <SharedListCard v-if="profile.data.value">
      <SharedPageState :loading="assignments.isLoading.value" :error="assignments.error.value" @retry="assignments.refetch">
        <SharedEmptyState v-if="!items.length" class="m-(--liwan-card-pad-dense)" :title="t('hrShifts.emptyMine')" :description="t('hrShifts.emptyMineHint')" />
        <ShiftAssignmentTable v-else :assignments="items" :caption="t('hr.self.schedule')" />
      </SharedPageState>
    </SharedListCard>
  </SharedListPage>
</template>
