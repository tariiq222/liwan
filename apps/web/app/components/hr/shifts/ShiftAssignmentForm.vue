<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import { ApiError } from '@/composables/useApi'
import { useCreateHrShiftAssignment } from '@/composables/useHrShifts'

// One employee's date-ranged work schedule. This panel only creates (`/hr/shifts/new`);
// the list row lets a manager end an existing assignment, and an empty date is an open
// end of the range.
const props = defineProps<{
  backTo: RouteLocationRaw
  employees: { value: string; label: string }[]
  schedules: { value: string; label: string }[]
}>()
const emit = defineEmits<{ saved: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const create = useCreateHrShiftAssignment()
const isPending = computed(() => create.isPending.value)

const employeeId = ref<number | null>(null)
const scheduleId = ref<number | null>(null)
const dateStart = ref<string | null>(null)
const dateEnd = ref<string | null>(null)
const attempted = ref(false)
const saved = ref(false)
const error = ref('')
const serverField = ref('')

const dirty = computed(() => !saved.value && Boolean(
  employeeId.value || scheduleId.value || dateStart.value || dateEnd.value,
))
const employeeError = computed(() => attempted.value && !employeeId.value ? t('hrShifts.form.employeeRequired') : fieldError('employee_id'))
const scheduleError = computed(() => attempted.value && !scheduleId.value ? t('hrShifts.form.scheduleRequired') : fieldError('schedule_id'))
const rangeError = computed(() => dateStart.value && dateEnd.value && dateEnd.value < dateStart.value
  ? t('hrShifts.form.rangeOrder')
  : fieldError('date_end'))

function fieldError(field: string) {
  return serverField.value === field ? error.value : undefined
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
    await create.mutateAsync({
      employee_id: employeeId.value,
      schedule_id: scheduleId.value,
      ...(dateStart.value ? { date_start: dateStart.value } : {}),
      ...(dateEnd.value ? { date_end: dateEnd.value } : {}),
    })
    saved.value = true
    await nextTick()
    emit('saved')
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : t('errors.generic')
    serverField.value = cause instanceof ApiError ? cause.field ?? '' : ''
  }
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <UForm novalidate :state="{ employeeId, scheduleId, dateStart, dateEnd }" class="webvue-form" method="post" data-testid="hr-shift-assignment-form" @submit="submit">
    <UAlert v-if="error && !serverField" role="alert" color="error" variant="subtle" :title="error" />
    <SharedFormSection panel :title="t('hrShifts.form.assignmentSection')" :description="t('hrShifts.form.assignmentHint')">
      <div class="grid gap-4">
        <UFormField :label="t('hrShifts.form.employee')" name="hr-shift-assignment-employee" required :error="employeeError">
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
          <UFormField :label="t('hrShifts.form.dateStart')" name="hr-shift-assignment-start" :help="t('hrShifts.form.openHint')">
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
          :label="t('hrShifts.form.create')"
          data-testid="hr-shift-assignment-submit"
        />
      </div>
    </SharedFormActions>
  </UForm>
</template>
