<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import { ApiError } from '@/composables/useApi'
import { useCreateHrShiftAssignment, useUpdateHrShiftAssignment, type HrShiftAssignment } from '@/composables/useHrShifts'

// One employee's date-ranged work schedule. Without an `assignment` it creates (`/hr/shifts/new`,
// where an empty start is today, the server default); with one it edits that row's schedule and
// range in place on its record page, the employee staying fixed. An empty end is an open end.
const props = defineProps<{
  backTo: RouteLocationRaw
  employees: { value: string; label: string }[]
  schedules: { value: string; label: string }[]
  assignment?: HrShiftAssignment
}>()
const emit = defineEmits<{ saved: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const create = useCreateHrShiftAssignment()
const update = useUpdateHrShiftAssignment()
const isPending = computed(() => create.isPending.value || update.isPending.value)
const sectionHint = computed(() => props.assignment
  ? t('hrShifts.form.editHint', { employee: props.assignment.employee.name })
  : t('hrShifts.form.assignmentHint'))

const employeeId = ref<number | null>(props.assignment?.employee.id ?? null)
const scheduleId = ref<number | null>(props.assignment?.schedule.id ?? null)
const dateStart = ref<string | null>(props.assignment?.date_start ?? null)
const dateEnd = ref<string | null>(props.assignment?.date_end ?? null)
const attempted = ref(false)
const saved = ref(false)
const error = ref('')
const serverField = ref('')

const dirty = computed(() => {
  if (saved.value) return false
  if (!props.assignment) return Boolean(employeeId.value || scheduleId.value || dateStart.value || dateEnd.value)
  return scheduleId.value !== props.assignment.schedule.id
    || dateStart.value !== props.assignment.date_start
    || dateEnd.value !== props.assignment.date_end
})
const employeeError = computed(() => attempted.value && !employeeId.value ? t('hrShifts.form.employeeRequired') : fieldError('employee_id'))
const scheduleError = computed(() => attempted.value && !scheduleId.value ? t('hrShifts.form.scheduleRequired') : fieldError('schedule_id'))
const rangeError = computed(() => dateStart.value && dateEnd.value && dateEnd.value < dateStart.value
  ? t('hrShifts.form.rangeOrder')
  : fieldError('date_end'))

function fieldError(field: string) {
  return serverField.value === field ? error.value : undefined
}

function apiMessage(cause: ApiError) {
  return cause.code === 'assignment_overlap' ? t('hrShifts.form.overlap') : cause.message
}

function pickEmployee(value: unknown) {
  employeeId.value = value ? Number(value) : null
}

function pickSchedule(value: unknown) {
  scheduleId.value = value ? Number(value) : null
}

async function submit() {
  if (!hydrated.value || isPending.value) return
  attempted.value = true
  error.value = ''
  serverField.value = ''
  if (!employeeId.value || !scheduleId.value) return
  if (dateStart.value && dateEnd.value && dateEnd.value < dateStart.value) return
  try {
    if (props.assignment) {
      await update.mutateAsync({
        id: props.assignment.id,
        patch: { schedule_id: scheduleId.value, date_start: dateStart.value, date_end: dateEnd.value },
      })
    } else {
      await create.mutateAsync({
        employee_id: employeeId.value,
        schedule_id: scheduleId.value,
        ...(dateStart.value ? { date_start: dateStart.value } : {}),
        ...(dateEnd.value ? { date_end: dateEnd.value } : {}),
      })
    }
    saved.value = true
    await nextTick()
    emit('saved')
  } catch (cause) {
    error.value = cause instanceof ApiError ? apiMessage(cause) : t('errors.generic')
    serverField.value = cause instanceof ApiError ? cause.field ?? '' : ''
  }
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" :guard-route-updates="!!props.assignment" />
  <UForm novalidate :state="{ employeeId, scheduleId, dateStart, dateEnd }" class="webvue-form" method="post" data-testid="hr-shift-assignment-form" @submit="submit">
    <UAlert v-if="error && !serverField" role="alert" color="error" variant="subtle" :title="error" />
    <SharedFormSection panel :title="t('hrShifts.form.assignmentSection')" :description="sectionHint">
      <div class="grid gap-4">
        <UFormField v-if="!props.assignment" :label="t('hrShifts.form.employee')" name="hr-shift-assignment-employee" required :error="employeeError">
          <USelect
            id="hr-shift-assignment-employee"
            class="w-full"
            :model-value="employeeId ? String(employeeId) : undefined"
            :items="props.employees"
            :placeholder="t('hrShifts.form.chooseEmployee')"
            :disabled="!hydrated || isPending"
            data-testid="hr-shift-assignment-employee"
            @update:model-value="pickEmployee"
          />
        </UFormField>
        <UFormField :label="t('hrShifts.form.schedule')" name="hr-shift-assignment-schedule" required :error="scheduleError">
          <USelect
            id="hr-shift-assignment-schedule"
            class="w-full"
            :model-value="scheduleId ? String(scheduleId) : undefined"
            :items="props.schedules"
            :placeholder="t('hrShifts.form.chooseSchedule')"
            :disabled="!hydrated || isPending"
            data-testid="hr-shift-assignment-schedule"
            @update:model-value="pickSchedule"
          />
        </UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="t('hrShifts.form.dateStart')" name="hr-shift-assignment-start" :error="fieldError('date_start')" :help="t(props.assignment ? 'hrShifts.form.openStartHint' : 'hrShifts.form.startHint')">
            <SharedDateField
              id="hr-shift-assignment-start"
              :model-value="dateStart"
              :disabled="!hydrated || isPending"
              data-testid="hr-shift-assignment-start"
              @update:model-value="dateStart = $event"
            />
          </UFormField>
          <UFormField :label="t('hrShifts.form.dateEnd')" name="hr-shift-assignment-end" :error="rangeError" :help="t('hrShifts.form.openHint')">
            <SharedDateField
              id="hr-shift-assignment-end"
              :model-value="dateEnd"
              :min-value="dateStart"
              :disabled="!hydrated || isPending"
              data-testid="hr-shift-assignment-end"
              @update:model-value="dateEnd = $event"
            />
          </UFormField>
        </div>
      </div>
    </SharedFormSection>
    <SharedFormActions>
      <span class="text-muted text-xs">{{ t('hrShifts.form.requiredHint') }}</span>
      <div class="ms-auto flex flex-wrap items-center gap-2">
        <UButton type="button" color="neutral" variant="outline" :to="props.backTo" :label="t('app.cancel')" />
        <UButton
          type="submit"
          color="primary"
          :disabled="!hydrated || isPending"
          :loading="isPending"
          :label="t(props.assignment ? 'hrShifts.form.save' : 'hrShifts.form.create')"
          data-testid="hr-shift-assignment-submit"
        />
      </div>
    </SharedFormActions>
  </UForm>
</template>
