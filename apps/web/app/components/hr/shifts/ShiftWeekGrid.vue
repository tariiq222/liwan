<script setup lang="ts">
import type { HrShiftSchedule, HrShiftWeek } from '@/composables/useHrShifts'

// One row per employee, one column per day of the week. A manager sets the whole week of a row
// from its schedule select (`schedules` given); without it the grid only reads.
const props = defineProps<{
  weeks: HrShiftWeek[]
  caption: string
  schedules?: HrShiftSchedule[]
  /** A week is being saved: every selector waits, so no choice is dropped silently. */
  busy?: boolean
  showEmployee?: boolean
}>()
const emit = defineEmits<{ set: [employeeId: number, scheduleId: number] }>()
const { t, locale } = useI18n()

const dayHeads = computed(() => (props.weeks[0]?.days ?? []).map((day) => {
  const date = new Date(`${day.date}T00:00:00Z`)
  return {
    date: day.date,
    label: new Intl.DateTimeFormat(locale.value, { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(date),
  }
}))

const scheduleItems = computed(() => (props.schedules ?? []).map(schedule => ({ value: schedule.id, label: schedule.name })))

function hours(value: number): string {
  const whole = Math.floor(value)
  const minutes = Math.round((value - whole) * 60)
  return `${String(whole).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}
</script>

<template>
  <div class="overflow-x-auto">
    <table class="w-full text-sm" data-testid="hr-shifts-week-grid">
      <caption class="sr-only">{{ caption }}</caption>
      <thead>
        <tr class="text-start text-muted">
          <th v-if="showEmployee !== false" scope="col" class="px-3 py-2 text-start font-medium">{{ t('hrShifts.columns.employee') }}</th>
          <th v-for="head in dayHeads" :key="head.date" scope="col" class="px-3 py-2 text-start font-medium">{{ head.label }}</th>
          <th v-if="schedules" scope="col" class="px-3 py-2 text-start font-medium">{{ t('hrShifts.setWeek') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="week in weeks" :key="week.employee.id" class="border-t border-default align-top">
          <th v-if="showEmployee !== false" scope="row" class="px-3 py-2 text-start font-semibold text-highlighted">{{ week.employee.name }}</th>
          <td v-for="day in week.days" :key="day.date" class="px-3 py-2">
            <template v-if="day.shifts.length">
              <p class="text-xs text-muted">{{ day.schedule?.name }}</p>
              <p
                v-for="(shift, index) in day.shifts"
                :key="index"
                class="tabular-nums"
                :class="shift.day_period === 'lunch' ? 'text-muted' : ''"
                dir="ltr"
              >
                {{ hours(shift.hour_from) }}–{{ hours(shift.hour_to) }}
                <span v-if="shift.day_period === 'lunch'" dir="auto">({{ t('hrShifts.periods.lunch') }})</span>
              </p>
            </template>
            <span v-else class="text-muted">{{ t('hrShifts.dayOff') }}</span>
          </td>
          <td v-if="schedules" class="px-3 py-2">
            <USelect
              :items="scheduleItems"
              :placeholder="t('hrShifts.setWeek')"
              :aria-label="t('hrShifts.setWeekFor', { name: week.employee.name })"
              :disabled="busy"
              class="min-w-40"
              @update:model-value="(value: number) => emit('set', week.employee.id, value)"
            />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
