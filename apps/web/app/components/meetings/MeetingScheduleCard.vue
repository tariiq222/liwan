<script setup lang="ts">
import type { MeetingSettings } from '@liwan/contracts'
import { MEETING_REFERENCE_PREFIX_PATTERN } from '@liwan/contracts'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'
import { useSaveMeetingSettings } from '@/composables/useMeetingSettings'

// The company's meetings settings as two cards: who may schedule, and the reminder window with the first segment of a
// new meeting's reference. Each card saves only its own values with the newest revision the page knows; when another
// session saved first the server answers 409, the card keeps the draft and locks until the saved settings are reloaded.
const props = defineProps<{ settings: MeetingSettings; canEdit: boolean; reloadSettings: () => Promise<MeetingSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: saveSettings } = useSaveMeetingSettings()

type ScheduleDraft = { schedule_policy: MeetingSettings['values']['schedule_policy'] }
type RemindersDraft = { reminder_hours: number | undefined; reference_prefix: string }
const schedule = useSettingsForm<MeetingSettings, ScheduleDraft>({
  source: () => props.settings,
  read: ({ values }) => ({ schedule_policy: values.schedule_policy }),
  save: (values, latest) => saveSettings({ revision: latest.revision, values: { schedule_policy: values.schedule_policy } }),
  reload: () => props.reloadSettings(),
})
const reminders = useSettingsForm<MeetingSettings, RemindersDraft>({
  source: () => props.settings,
  read: ({ values }) => ({ reminder_hours: values.reminder_hours, reference_prefix: values.reference_prefix }),
  save: (values, latest) => saveSettings({ revision: latest.revision, values: { reminder_hours: values.reminder_hours!, reference_prefix: values.reference_prefix } }),
  reload: () => props.reloadSettings(),
})
const locked = (form: { state: { value: { saving: boolean; reloading: boolean; conflict: boolean } } }) =>
  !hydrated.value || !props.canEdit || form.state.value.saving || form.state.value.reloading || form.state.value.conflict
const items = computed(() => props.settings.options.schedule_policy.map(value => ({
  value,
  label: t(`meetingsSettings.schedule.${value}`),
  description: t(`meetingsSettings.schedule.${value}Hint`),
})))

// The server states the bounds; the prefix shape is the contract's CHECK pattern.
const hoursRange = computed(() => props.settings.options.reminder_hours)
const reminderInvalid = computed(() => {
  const hours = reminders.draft.value.reminder_hours
  return !Number.isInteger(hours) || hours! < hoursRange.value.min || hours! > hoursRange.value.max
})
const prefixInvalid = computed(() => !MEETING_REFERENCE_PREFIX_PATTERN.test(reminders.draft.value.reference_prefix))
const reminderError = computed(() => reminderInvalid.value ? t('meetingsSettings.reminders.hoursRange', hoursRange.value) : undefined)
const prefixError = computed(() => prefixInvalid.value ? t('meetingsSettings.reminders.prefixInvalid') : undefined)

async function submitSchedule() {
  if (!hydrated.value || !props.canEdit) return
  await schedule.save()
}
async function submitReminders() {
  if (!hydrated.value || !props.canEdit || reminderInvalid.value || prefixInvalid.value) return
  await reminders.save()
}
</script>

<template>
  <SharedSettingsCard id="meetings-schedule" v-bind="schedule.state.value" :title="t('meetingsSettings.schedule.title')" :description="t('meetingsSettings.schedule.hint')" :can-edit="canEdit" data-testid="meetings-schedule" @save="submitSchedule" @revert="schedule.revert" @reload="schedule.reload">
    <UFormField orientation="horizontal" :label="t('meetingsSettings.schedule.label')" name="schedule_policy">
      <URadioGroup v-model="schedule.draft.value.schedule_policy" :items="items" :disabled="locked(schedule)" data-testid="meetings-schedule-policy" />
    </UFormField>
  </SharedSettingsCard>
  <SharedSettingsCard id="meetings-reminders" v-bind="reminders.state.value" :title="t('meetingsSettings.reminders.title')" :description="t('meetingsSettings.reminders.hint')" :can-edit="canEdit" @save="submitReminders" @revert="reminders.revert" @reload="reminders.reload">
    <UFormField orientation="horizontal" :label="t('meetingsSettings.reminders.hoursLabel')" name="reminder_hours" required :description="t('meetingsSettings.reminders.hoursHelp')" :error="reminderError">
      <UInputNumber v-model="reminders.draft.value.reminder_hours" :min="hoursRange.min" :max="hoursRange.max" :step="1" class="w-full" :disabled="locked(reminders)" data-testid="meetings-reminder-hours" />
    </UFormField>
    <UFormField orientation="horizontal" :label="t('meetingsSettings.reminders.prefixLabel')" name="reference_prefix" required :description="t('meetingsSettings.reminders.prefixHelp')" :error="prefixError">
      <UInput v-model="reminders.draft.value.reference_prefix" dir="ltr" :maxlength="settings.options.reference_prefix.max_length" class="w-full" :disabled="locked(reminders)" data-testid="meetings-reference-prefix" />
    </UFormField>
  </SharedSettingsCard>
</template>
