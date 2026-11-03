<script setup lang="ts">
import type { MeetingSchedulePolicy, MeetingSettings, MeetingSettingsPatch } from '@liwan/contracts'
import { MEETING_REFERENCE_PREFIX_PATTERN } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { useSaveMeetingSettings } from '@/composables/useMeetingSettings'
import { saveErrorMessage } from '@/utils/formFeedback'

// The company's meetings settings: who may schedule, how long before a meeting its reminder is
// sent, and the first segment of a new meeting's reference. A save carries the revision the card
// was made from and only the changed values; when another session saved first the server answers
// 409, the card reads the saved settings again and tells the manager, and a 422 naming a field
// renders next to that field.
const props = defineProps<{ settings: MeetingSettings; reloadSettings: () => Promise<MeetingSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const save = useSaveMeetingSettings()

const baseline = ref(props.settings)
const policy = ref<MeetingSchedulePolicy>(props.settings.values.schedule_policy)
const reminderHours = ref<number>(props.settings.values.reminder_hours)
const referencePrefix = ref(props.settings.values.reference_prefix)
const reloading = ref(false)
const notice = ref<'conflict' | 'reloadFailed' | null>(null)
const failure = ref<string | null>(null)
const serverFieldErrors = ref<Partial<Record<'reminder_hours' | 'reference_prefix', string>>>({})

const dirty = computed(() => policy.value !== baseline.value.values.schedule_policy
  || reminderHours.value !== baseline.value.values.reminder_hours
  || referencePrefix.value !== baseline.value.values.reference_prefix)
const busy = computed(() => !hydrated.value || save.isPending.value || reloading.value)
const items = computed(() => baseline.value.options.schedule_policy.map(value => ({
  value,
  label: t(`meetingsSettings.schedule.${value}`),
  description: t(`meetingsSettings.schedule.${value}Hint`),
})))

// The server states the bounds; the prefix shape is the contract's CHECK pattern.
const reminderInvalid = computed(() => !Number.isInteger(reminderHours.value)
  || reminderHours.value < baseline.value.options.reminder_hours.min
  || reminderHours.value > baseline.value.options.reminder_hours.max)
const prefixInvalid = computed(() => !MEETING_REFERENCE_PREFIX_PATTERN.test(referencePrefix.value))
const reminderError = computed(() => reminderInvalid.value
  ? t('meetingsSettings.reminders.hoursRange', { min: baseline.value.options.reminder_hours.min, max: baseline.value.options.reminder_hours.max })
  : serverFieldErrors.value.reminder_hours ?? '')
const prefixError = computed(() => prefixInvalid.value
  ? t('meetingsSettings.reminders.prefixInvalid')
  : serverFieldErrors.value.reference_prefix ?? '')

function adopt(settings: MeetingSettings) {
  baseline.value = settings
  policy.value = settings.values.schedule_policy
  reminderHours.value = settings.values.reminder_hours
  referencePrefix.value = settings.values.reference_prefix
}
// A refresh of the settings reaches a card with no edits; a draft in progress is kept and saves against its revision.
watch(() => props.settings, (settings) => {
  if (!dirty.value && !busy.value) adopt(settings)
})

async function readSavedSettings() {
  reloading.value = true
  try {
    adopt(await props.reloadSettings())
    notice.value = 'conflict'
  } catch {
    notice.value = 'reloadFailed'
  } finally {
    reloading.value = false
  }
}

async function submit() {
  if (busy.value || !dirty.value || reminderInvalid.value || prefixInvalid.value) return
  failure.value = null
  notice.value = null
  serverFieldErrors.value = {}
  const values: MeetingSettingsPatch['values'] = {}
  if (policy.value !== baseline.value.values.schedule_policy) values.schedule_policy = policy.value
  if (reminderHours.value !== baseline.value.values.reminder_hours) values.reminder_hours = reminderHours.value
  if (referencePrefix.value !== baseline.value.values.reference_prefix) values.reference_prefix = referencePrefix.value
  try {
    adopt(await save.mutateAsync({ revision: baseline.value.revision, values }))
    toast.add({ title: t('meetingsSettings.saved'), color: 'success' })
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) return readSavedSettings()
    if (error instanceof ApiError && error.status === 422 && (error.field === 'reminder_hours' || error.field === 'reference_prefix')) {
      serverFieldErrors.value = { [error.field]: error.message }
      return
    }
    failure.value = saveErrorMessage(error, t('errors.generic'), t('errors.saveUncertain'))
  }
}
</script>

<template>
  <UForm novalidate :state="{ policy, reminderHours, referencePrefix }" class="liwan-form" method="post" data-testid="meetings-schedule" @submit="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedFormSection panel :title="t('meetingsSettings.schedule.title')" :description="t('meetingsSettings.schedule.hint')">
      <UAlert v-if="notice === 'conflict'" role="status" color="warning" variant="subtle" icon="i-lucide-refresh-cw" :title="t('meetingsSettings.conflict')" data-testid="meetings-schedule-conflict" />
      <UAlert v-else-if="notice === 'reloadFailed'" role="alert" color="error" variant="subtle" :title="t('meetingsSettings.reloadFailed')" data-testid="meetings-schedule-reload-error" />
      <UAlert v-if="failure" role="alert" color="error" variant="subtle" :title="t('meetingsSettings.saveFailed')" :description="failure" data-testid="meetings-schedule-error" />
      <UFormField :label="t('meetingsSettings.schedule.label')" name="schedule_policy">
        <URadioGroup v-model="policy" :items="items" :disabled="busy" data-testid="meetings-schedule-policy" />
      </UFormField>
    </SharedFormSection>
    <SharedFormSection panel :title="t('meetingsSettings.reminders.title')" :description="t('meetingsSettings.reminders.hint')">
      <UFormField
        :label="t('meetingsSettings.reminders.hoursLabel')" name="reminder_hours" required
        :description="t('meetingsSettings.reminders.hoursHelp')" :error="reminderError"
      >
        <UInputNumber
          v-model="reminderHours" :min="baseline.options.reminder_hours.min" :max="baseline.options.reminder_hours.max" :step="1"
          class="w-full" :disabled="busy" data-testid="meetings-reminder-hours"
        />
      </UFormField>
      <UFormField
        :label="t('meetingsSettings.reminders.prefixLabel')" name="reference_prefix" required
        :description="t('meetingsSettings.reminders.prefixHelp')" :error="prefixError"
      >
        <UInput v-model="referencePrefix" dir="ltr" :maxlength="baseline.options.reference_prefix.max_length" class="w-full" :disabled="busy" data-testid="meetings-reference-prefix" />
      </UFormField>
    </SharedFormSection>
    <SharedFormActions>
      <UButton type="submit" class="ms-auto" :loading="save.isPending.value" :disabled="busy || !dirty || reminderInvalid || prefixInvalid" :label="t('app.saveChanges')" data-testid="meetings-schedule-save" />
    </SharedFormActions>
  </UForm>
</template>
