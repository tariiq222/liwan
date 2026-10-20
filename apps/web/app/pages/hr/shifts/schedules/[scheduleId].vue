<script setup lang="ts">
import { owningListBack } from '@/utils/recordListOrigin'
import { ApiError } from '@/composables/useApi'
import { useArchiveHrShiftSchedule, useHrShiftSchedule } from '@/composables/useHrShifts'
import ShiftScheduleForm from '@/components/hr/shifts/ShiftScheduleForm.vue'

// One work schedule: its lines, its timezone and the hours it adds up to. Editing happens
// in place (the /new panel is the only create route) and archiving asks inline first.
const route = useRoute()
const { t, n } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()

const id = computed(() => Number(route.params.scheduleId))
const validId = computed(() => Number.isSafeInteger(id.value) && id.value > 0)
const query = useHrShiftSchedule(computed(() => validId.value ? id.value : null))
const schedule = computed(() => query.data.value ?? null)
const pageError = computed(() => query.error.value ?? (validId.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const sourcePaths = useRecordListPaths(['/hr/shifts/schedules'])
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
const canManage = computed(() => can('hr.shifts.manage'))

const editing = ref(false)
const archiving = ref(false)
const archiveError = ref('')
const { mutateAsync: archiveSchedule, isPending: archivingPending } = useArchiveHrShiftSchedule()

function hour(value: number) {
  return n(value)
}

async function confirmArchive() {
  if (!schedule.value || !hydrated.value || archivingPending.value) return
  archiveError.value = ''
  try {
    await archiveSchedule(schedule.value.id)
    archiving.value = false
  } catch (cause) {
    // A schedule still planned for an employee is refused by the engine (422).
    archiveError.value = cause instanceof ApiError ? cause.message : t('errors.generic')
  }
}

async function onSaved() {
  editing.value = false
  await query.refetch()
}
</script>

<template>
  <SharedRecordPage
    :title="schedule?.name || t('hrShifts.schedulesTitle')"
    :description="t('hrShifts.scheduleDescription')"
    :back-to="backTo"
    :back-label="t('hrShifts.schedulesTitle')"
    :loading="query.isLoading.value"
    :error="pageError"
    :keep-content="!!schedule"
    @retry="query.refetch"
  >
    <template v-if="schedule && canManage" #actions>
      <UButton
        v-if="!editing"
        color="neutral"
        variant="outline"
        icon="i-lucide-pencil"
        :disabled="!hydrated"
        :label="t('hrShifts.editSchedule')"
        data-testid="hr-shift-schedule-edit"
        @click="editing = true"
      />
      <UButton
        v-else
        color="neutral"
        variant="ghost"
        icon="i-lucide-x"
        :label="t('app.cancel')"
        data-testid="hr-shift-schedule-cancel"
        @click="editing = false"
      />
      <UButton
        v-if="schedule.active"
        color="error"
        variant="outline"
        icon="i-lucide-archive"
        :disabled="!hydrated"
        :label="t('hrShifts.archive')"
        data-testid="hr-shift-schedule-archive"
        @click="archiving = true"
      />
    </template>

    <UAlert v-if="archiveError" role="alert" color="error" variant="subtle" :title="archiveError" data-testid="hr-shift-schedule-archive-error" />
    <SharedInlineConfirm
      v-if="archiving"
      :title="t('hrShifts.archiveConfirm', { name: schedule?.name ?? '' })"
      :confirm-label="t('hrShifts.archive')"
      :cancel-label="t('app.back')"
      :pending="archivingPending"
      :disabled="!hydrated"
      color="error"
      @confirm="confirmArchive"
      @cancel="archiving = false"
    />

    <template v-if="schedule && editing">
      <SharedRecordSection variant="panel" :title="t('hrShifts.editSchedule')">
        <ShiftScheduleForm :schedule="schedule" :back-to="backTo" @saved="onSaved" />
      </SharedRecordSection>
    </template>

    <template v-else-if="schedule">
      <SharedIdentityCard :id="schedule.id" :name="schedule.name" :subtitle="schedule.tz || 'UTC'">
        <template #badge>
          <SharedStatusBadge
            size="sm"
            :tone="schedule.active ? 'success' : 'neutral'"
            :label="schedule.active ? t('hrShifts.stateActive') : t('hrShifts.stateArchived')"
          />
        </template>
      </SharedIdentityCard>

      <SharedRecordSection variant="list" :title="t('hrShifts.form.attendances')" :description="t('hrShifts.form.attendancesHint')">
        <ul class="divide-y divide-default">
          <li
            v-for="(line, index) in schedule.attendances"
            :key="index"
            class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-(--webvue-card-pad) py-3 text-sm"
            data-testid="hr-shift-schedule-line"
          >
            <span class="font-medium">{{ t(`hrShifts.days.${line.dayofweek}`) }}</span>
            <span class="text-muted">{{ t(`hrShifts.periods.${line.day_period}`) }}</span>
            <bdi class="tabular-nums">{{ hour(line.hour_from) }} – {{ hour(line.hour_to) }}</bdi>
          </li>
        </ul>
      </SharedRecordSection>
    </template>

    <template v-if="schedule" #aside>
      <SharedPropertiesPanel>
        <SharedPropertyRow :label="t('hrShifts.form.tz')" :value="schedule.tz || 'UTC'" />
        <SharedPropertyRow :label="t('hrShifts.columns.hoursPerWeek')" :value="hour(schedule.hours_per_week)" />
        <SharedPropertyRow :label="t('hrShifts.columns.attendances')" :value="schedule.attendances.length" />
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
</template>
