<script setup lang="ts">
import { owningListBack } from '@/utils/recordListOrigin'
import { ApiError } from '@/composables/useApi'
import { useHrShiftAssignment, useHrShiftPeriod, useHrShiftSchedules } from '@/composables/useHrShifts'
import ShiftAssignmentForm from '@/components/hr/shifts/ShiftAssignmentForm.vue'

// One employee's planned work schedule. Editing its schedule and range happens in place
// (the /new panel is the only create route); removing stays on the list's inline confirmation.
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()

const id = computed(() => Number(route.params.assignmentId))
const validId = computed(() => Number.isSafeInteger(id.value) && id.value > 0)
const query = useHrShiftAssignment(computed(() => validId.value ? id.value : null))
const assignment = computed(() => query.data.value ?? null)
const pageError = computed(() => query.error.value ?? (validId.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const sourcePaths = useRecordListPaths(['/hr/shifts'])
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
const canManage = computed(() => can('hr.shifts.manage'))

const editing = ref(false)
const schedules = useHrShiftSchedules(computed(() => ({ active: 'true' as const, limit: 200, offset: 0 })))
// The current schedule stays choosable even when it has since been archived.
const scheduleOptions = computed(() => {
  const options = (schedules.data.value?.items ?? []).map(schedule => ({ value: String(schedule.id), label: schedule.name }))
  const current = assignment.value?.schedule
  return current && !options.some(option => option.value === String(current.id))
    ? [{ value: String(current.id), label: current.name }, ...options]
    : options
})

const period = useHrShiftPeriod()

async function onSaved() {
  editing.value = false
  await query.refetch()
}
</script>

<template>
  <SharedForbiddenState v-if="!can('hr.shifts.read')" />
  <SharedRecordPage
    v-else
    :title="assignment?.employee.name || t('hrShifts.assignmentTitle')"
    :back-to="backTo"
    :back-label="t('hrShifts.title')"
    :loading="query.isLoading.value"
    :error="pageError"
    :keep-content="!!assignment"
    @retry="query.refetch"
  >
    <template v-if="assignment && canManage" #actions>
      <UButton
        v-if="!editing"
        color="neutral"
        variant="outline"
        icon="i-lucide-pencil"
        :disabled="!hydrated"
        :label="t('hrShifts.editAssignment')"
        data-testid="hr-shift-assignment-edit"
        @click="editing = true"
      />
      <UButton
        v-else
        color="neutral"
        variant="ghost"
        icon="i-lucide-x"
        :label="t('app.cancel')"
        data-testid="hr-shift-assignment-cancel"
        @click="editing = false"
      />
    </template>

    <template v-if="assignment && editing">
      <SharedPageState :loading="schedules.isLoading.value" :error="schedules.error.value" @retry="schedules.refetch">
        <ShiftAssignmentForm :assignment="assignment" :back-to="backTo" :employees="[]" :schedules="scheduleOptions" @saved="onSaved" />
      </SharedPageState>
    </template>

    <template v-else-if="assignment">
      <SharedIdentityCard :id="assignment.id" :name="assignment.employee.name" :subtitle="assignment.schedule.name" />
    </template>

    <template v-if="assignment" #aside>
      <SharedPropertiesPanel>
        <SharedPropertyRow :label="t('hrShifts.columns.schedule')">
          <NuxtLink :to="`/hr/shifts/schedules/${assignment.schedule.id}`" class="text-(--brand-link) hover:underline">{{ assignment.schedule.name }}</NuxtLink>
        </SharedPropertyRow>
        <SharedPropertyRow :label="t('hrShifts.columns.period')"><bdi class="tabular-nums">{{ period(assignment) }}</bdi></SharedPropertyRow>
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
</template>
