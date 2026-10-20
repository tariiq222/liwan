<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { HrShiftAttendance, HrShiftSchedule } from '@webvue/contracts'
import { ApiError } from '@/composables/useApi'
import { SHIFT_WEEK_START } from '@/utils/hrShiftWeek'
import { useCreateHrShiftSchedule, useUpdateHrShiftSchedule } from '@/composables/useHrShifts'
import ShiftAttendanceEditor from '@/components/hr/shifts/ShiftAttendanceEditor.vue'

// One work schedule: its name, its timezone and its work-time lines. The same form creates
// (`/hr/shifts/schedules/new`) and edits (the schedule record page); saving returns to backTo.
const props = defineProps<{ schedule?: HrShiftSchedule | null; backTo: RouteLocationRaw }>()
const emit = defineEmits<{ saved: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { me } = useMe()
const create = useCreateHrShiftSchedule()
const update = useUpdateHrShiftSchedule()
const isPending = computed(() => create.isPending.value || update.isPending.value)

const DEFAULT_LINE: HrShiftAttendance = { dayofweek: SHIFT_WEEK_START, day_period: 'morning', hour_from: 8, hour_to: 12, week_type: null }
const initialName = props.schedule?.name ?? ''
const initialTz = props.schedule?.tz ?? me.value?.tz ?? 'UTC'
const initialAttendances = JSON.stringify(props.schedule?.attendances ?? [DEFAULT_LINE])

const name = ref(initialName)
const tz = ref(initialTz)
const attendances = ref<HrShiftAttendance[]>(
  props.schedule ? props.schedule.attendances.map(line => ({ ...line })) : [{ ...DEFAULT_LINE }],
)
const attempted = ref(false)
const saved = ref(false)
const error = ref('')
const serverField = ref('')

const dirty = computed(() => !saved.value && (
  name.value.trim() !== initialName.trim()
  || tz.value.trim() !== initialTz.trim()
  || JSON.stringify(attendances.value) !== initialAttendances
))
const nameError = computed(() => attempted.value && !name.value.trim() ? t('hrShifts.form.nameRequired') : fieldError('name'))
const tzError = computed(() => attempted.value && !tz.value.trim() ? t('hrShifts.form.tzRequired') : fieldError('tz'))
const linesError = computed(() => attempted.value && !attendances.value.length ? t('hrShifts.form.lineRequired') : undefined)

function fieldError(field: string) {
  return serverField.value === field ? error.value : undefined
}

async function submit() {
  if (!hydrated.value || isPending.value) return
  attempted.value = true
  error.value = ''
  serverField.value = ''
  if (!name.value.trim() || !tz.value.trim() || !attendances.value.length) return
  if (attendances.value.some(line => line.hour_to < line.hour_from)) {
    error.value = t('hrShifts.form.hoursOrder')
    return
  }
  const body = { name: name.value.trim(), tz: tz.value.trim(), attendances: attendances.value }
  try {
    if (props.schedule) await update.mutateAsync({ id: props.schedule.id, patch: body })
    else await create.mutateAsync({ ...body, two_weeks: false })
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
  <UForm novalidate :state="{ name, tz, attendances }" class="webvue-form" method="post" data-testid="hr-shift-schedule-form" @submit="submit">
    <UAlert v-if="error && !serverField" role="alert" color="error" variant="subtle" :title="error" />
    <SharedFormSection panel :title="t('hrShifts.form.scheduleSection')">
      <div class="grid gap-4">
        <UFormField :label="t('hrShifts.form.name')" name="hr-shift-schedule-name" required :error="nameError">
          <UInput
            id="hr-shift-schedule-name"
            v-model="name"
            class="w-full"
            :disabled="!hydrated || isPending"
            data-testid="hr-shift-schedule-name"
          />
        </UFormField>
        <UFormField :label="t('hrShifts.form.tz')" name="hr-shift-schedule-tz" required :error="tzError" :help="t('hrShifts.form.tzHint')">
          <UInput
            id="hr-shift-schedule-tz"
            v-model="tz"
            dir="ltr"
            class="w-full"
            :disabled="!hydrated || isPending"
            data-testid="hr-shift-schedule-tz"
          />
        </UFormField>
      </div>
    </SharedFormSection>
    <SharedFormSection panel :title="t('hrShifts.form.attendances')" :description="t('hrShifts.form.attendancesHint')">
      <ShiftAttendanceEditor v-model="attendances" :disabled="!hydrated || isPending" />
      <p v-if="linesError" class="text-error text-sm">{{ linesError }}</p>
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
          :label="props.schedule ? t('hrShifts.form.save') : t('hrShifts.form.create')"
          data-testid="hr-shift-schedule-submit"
        />
      </div>
    </SharedFormActions>
  </UForm>
</template>
