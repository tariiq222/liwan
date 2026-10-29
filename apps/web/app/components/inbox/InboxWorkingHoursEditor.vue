<script setup lang="ts">
import { DEFAULT_RANGE, WEEK_ORDER, overlappingWeekdays, timezoneChoices, type HoursDraft } from '@/composables/inbox/inboxAutomation'

// The weekly hours grid (several ranges per day), the timezone and the holidays. A day with no range is closed; no
// range at all means the inbox is always open. It only edits the draft: the page or form that hosts it saves.
const draft = defineModel<HoursDraft>({ required: true })
const props = defineProps<{ disabled?: boolean }>()
const { t } = useI18n()
const hydrated = useHydrated()
const off = computed(() => !hydrated.value || props.disabled)
const overlapping = computed(() => new Set(overlappingWeekdays(draft.value)))
const zoneItems = computed(() => timezoneChoices(draft.value.timezone).map(value => ({ value, label: value })))
const weekdayName = (weekday: number) => t(`inbox.automation.hours.weekdays.${weekday}`)

function toggleDay(weekday: number, open: boolean) {
  draft.value.week[weekday] = open ? [{ ...DEFAULT_RANGE }] : []
}
function addRange(weekday: number) {
  const ranges = draft.value.week[weekday]!
  const last = ranges.at(-1)
  ranges.push(last && last.to < '23:00' ? { from: last.to, to: '23:00' } : { ...DEFAULT_RANGE })
}
function removeRange(weekday: number, index: number) {
  draft.value.week[weekday]!.splice(index, 1)
}
function addHoliday() {
  const today = new Date().toISOString().slice(0, 10)
  draft.value.holidays.push({ name: '', date_from: today, date_to: today })
}
function removeHoliday(index: number) {
  draft.value.holidays.splice(index, 1)
}
</script>

<template>
  <div class="flex flex-col gap-5" data-testid="inbox-hours-editor">
    <UFormField :label="t('inbox.automation.hours.timezone')">
      <USelect v-model="draft.timezone" :items="zoneItems" class="w-full sm:w-72" :disabled="off" dir="ltr" data-testid="inbox-hours-timezone" />
    </UFormField>

    <fieldset class="flex flex-col gap-1">
      <legend class="mb-1 text-sm font-medium text-highlighted">{{ t('inbox.automation.hours.week') }}</legend>
      <p v-if="!draft.week.some(day => day.length)" class="text-sm text-muted" data-testid="inbox-hours-always-open">{{ t('inbox.automation.hours.alwaysOpen') }}</p>
      <div v-for="weekday in WEEK_ORDER" :key="weekday" class="flex flex-wrap items-start gap-3 border-b border-default py-2 last:border-b-0" :data-testid="`inbox-hours-day-${weekday}`">
        <div class="flex w-36 items-center gap-2 pt-1.5">
          <USwitch :model-value="draft.week[weekday]!.length > 0" :aria-label="weekdayName(weekday)" :disabled="off" @update:model-value="toggleDay(weekday, $event)" />
          <span class="text-sm" :class="draft.week[weekday]!.length ? 'font-medium text-highlighted' : 'text-muted'">{{ weekdayName(weekday) }}</span>
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-2">
          <p v-if="!draft.week[weekday]!.length" class="pt-1.5 text-sm text-muted">{{ t('inbox.automation.hours.closed') }}</p>
          <div v-for="(range, index) in draft.week[weekday]" :key="index" class="flex flex-wrap items-center gap-2">
            <UInput v-model="range.from" type="time" :aria-label="t('inbox.automation.hours.from', { day: weekdayName(weekday) })" :disabled="off" dir="ltr" class="w-32" />
            <span class="text-muted" aria-hidden="true">–</span>
            <UInput v-model="range.to" type="time" :aria-label="t('inbox.automation.hours.to', { day: weekdayName(weekday) })" :disabled="off" dir="ltr" class="w-32" />
            <UButton type="button" color="neutral" variant="ghost" square icon="i-lucide-x" :disabled="off" :aria-label="t('inbox.automation.hours.removeRange', { day: weekdayName(weekday) })" @click="removeRange(weekday, index)" />
          </div>
          <p v-if="overlapping.has(weekday)" class="text-sm text-error" role="alert">{{ t('inbox.automation.hours.overlap') }}</p>
          <UButton v-if="draft.week[weekday]!.length" type="button" class="self-start" size="xs" color="neutral" variant="ghost" icon="i-lucide-plus" :disabled="off" :label="t('inbox.automation.hours.addRange')" @click="addRange(weekday)" />
        </div>
      </div>
    </fieldset>

    <fieldset class="flex flex-col gap-2">
      <legend class="mb-1 text-sm font-medium text-highlighted">{{ t('inbox.automation.hours.holidays') }}</legend>
      <p class="text-sm text-muted">{{ t('inbox.automation.hours.holidaysHint') }}</p>
      <div v-for="(holiday, index) in draft.holidays" :key="index" class="flex flex-wrap items-end gap-2" :data-testid="`inbox-holiday-${index}`">
        <UFormField class="min-w-40 flex-1" :label="t('inbox.automation.hours.holidayName')">
          <UInput v-model="holiday.name" class="w-full" maxlength="128" :disabled="off" />
        </UFormField>
        <UFormField :label="t('inbox.automation.hours.holidayFrom')">
          <UInput v-model="holiday.date_from" type="date" dir="ltr" :disabled="off" />
        </UFormField>
        <UFormField :label="t('inbox.automation.hours.holidayTo')">
          <UInput v-model="holiday.date_to" type="date" dir="ltr" :disabled="off" />
        </UFormField>
        <UButton type="button" color="neutral" variant="ghost" square icon="i-lucide-trash-2" :disabled="off" :aria-label="t('inbox.automation.hours.removeHoliday')" @click="removeHoliday(index)" />
      </div>
      <UButton type="button" class="self-start" color="neutral" variant="outline" icon="i-lucide-plus" :disabled="off || draft.holidays.length >= 100" :label="t('inbox.automation.hours.addHoliday')" data-testid="inbox-holiday-add" @click="addHoliday" />
    </fieldset>
  </div>
</template>
