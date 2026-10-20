<script setup lang="ts">
import type { HrShiftAttendance } from '@webvue/contracts'
import { SHIFT_WEEK_ORDER, SHIFT_WEEK_START } from '@/utils/hrShiftWeek'

// The work-time lines of a schedule form: one row per period. A line is
// {dayofweek, day_period, hour_from, hour_to, week_type}; this release never
// creates two-week calendars, so week_type stays null.
const props = defineProps<{ modelValue: HrShiftAttendance[]; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: HrShiftAttendance[]] }>()
const { t } = useI18n()

const PERIODS: readonly HrShiftAttendance['day_period'][] = ['morning', 'lunch', 'afternoon', 'full_day']
const NEW_LINE: HrShiftAttendance = { dayofweek: SHIFT_WEEK_START, day_period: 'morning', hour_from: 8, hour_to: 12, week_type: null }

const dayItems = computed(() => SHIFT_WEEK_ORDER.map(day => ({ value: day, label: t(`hrShifts.days.${day}`) })))
const periodItems = computed(() => PERIODS.map(period => ({ value: period, label: t(`hrShifts.periods.${period}`) })))
const rows = computed(() => props.modelValue)

function update(index: number, patch: Partial<HrShiftAttendance>) {
  emit('update:modelValue', props.modelValue.map((row, position) => position === index ? { ...row, ...patch } : row))
}

function updateDay(index: number, value: unknown) {
  update(index, { dayofweek: String(value) as HrShiftAttendance['dayofweek'] })
}

function updatePeriod(index: number, value: unknown) {
  update(index, { day_period: String(value) as HrShiftAttendance['day_period'] })
}

function updateHour(index: number, field: 'hour_from' | 'hour_to', value: unknown) {
  const number = Number(value)
  if (!Number.isFinite(number)) return
  update(index, { [field]: Math.min(24, Math.max(0, number)) })
}

function addLine() {
  emit('update:modelValue', [...props.modelValue, { ...NEW_LINE }])
}

function removeLine(index: number) {
  emit('update:modelValue', props.modelValue.filter((_, position) => position !== index))
}
</script>

<template>
  <div class="grid gap-3" data-testid="hr-shifts-attendances">
    <div
      v-for="(row, index) in rows"
      :key="index"
      class="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
      data-testid="hr-shifts-attendance-row"
    >
      <UFormField :label="t('hrShifts.form.day')" :name="`hr-shifts-day-${index}`">
        <USelect
          :model-value="row.dayofweek"
          :items="dayItems"
          class="w-full"
          :disabled="disabled"
          :aria-label="t('hrShifts.form.day')"
          @update:model-value="updateDay(index, $event)"
        />
      </UFormField>
      <UFormField :label="t('hrShifts.form.period')" :name="`hr-shifts-period-${index}`">
        <USelect
          :model-value="row.day_period"
          :items="periodItems"
          class="w-full"
          :disabled="disabled"
          :aria-label="t('hrShifts.form.period')"
          @update:model-value="updatePeriod(index, $event)"
        />
      </UFormField>
      <UFormField :label="t('hrShifts.form.hourFrom')" :name="`hr-shifts-from-${index}`">
        <UInput
          :model-value="String(row.hour_from)"
          type="number"
          min="0"
          max="24"
          step="0.5"
          class="w-full tabular-nums"
          :disabled="disabled"
          :aria-label="t('hrShifts.form.hourFrom')"
          @update:model-value="updateHour(index, 'hour_from', $event)"
        />
      </UFormField>
      <UFormField :label="t('hrShifts.form.hourTo')" :name="`hr-shifts-to-${index}`">
        <UInput
          :model-value="String(row.hour_to)"
          type="number"
          min="0"
          max="24"
          step="0.5"
          class="w-full tabular-nums"
          :disabled="disabled"
          :aria-label="t('hrShifts.form.hourTo')"
          @update:model-value="updateHour(index, 'hour_to', $event)"
        />
      </UFormField>
      <UButton
        type="button"
        color="neutral"
        variant="ghost"
        square
        icon="i-lucide-trash-2"
        :label="t('hrShifts.form.removeLine')"
        :aria-label="t('hrShifts.form.removeLine')"
        :title="t('hrShifts.form.removeLine')"
        :disabled="disabled || rows.length <= 1"
        @click="removeLine(index)"
      />
    </div>
    <div>
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        icon="i-lucide-plus"
        :label="t('hrShifts.form.addLine')"
        :disabled="disabled"
        data-testid="hr-shifts-add-line"
        @click="addLine"
      />
    </div>
  </div>
</template>
