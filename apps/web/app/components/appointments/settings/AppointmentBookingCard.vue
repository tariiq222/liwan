<script setup lang="ts">
import type { AppointmentSettings } from '@webvue/contracts'
import { APPOINTMENT_RANGES, bookingDraft, bookingDraftValid, isInRange, settingsPatch, type BookingDraft } from '@/composables/appointments/appointmentSettings'
import { useSaveAppointmentSettings } from '@/composables/appointments/useAppointmentSettings'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'

// The timing rules of a booking: the length a new type starts with, the notice and horizon every booking route keeps, and
// how long before the start a requester may still change it.
const props = defineProps<{ settings: AppointmentSettings; canEdit: boolean; reloadSettings: () => Promise<AppointmentSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { mutateAsync: saveSettings } = useSaveAppointmentSettings()
const { draft, state, save, revert, reload } = useSettingsForm<AppointmentSettings, BookingDraft>({
  source: () => props.settings,
  read: bookingDraft,
  save: async (values, latest) => {
    const saved = await saveSettings(settingsPatch(latest, values))
    toast.add({ title: t('appointments.settings.saved'), color: 'success' })
    return saved
  },
  reload: () => props.reloadSettings(),
})
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading)
const fields = ['default_slot_minutes', 'min_notice_hours', 'horizon_days', 'modification_deadline_hours'] as const
const errorOf = (key: (typeof fields)[number]) => isInRange(draft.value[key], APPOINTMENT_RANGES[key])
  ? undefined
  : t('appointments.settings.booking.invalid', APPOINTMENT_RANGES[key])
// A value outside the bounds is told at its input and is not sent.
const submit = () => { if (bookingDraftValid(draft.value)) return save() }
</script>

<template>
  <SharedSettingsCard id="booking" v-bind="state" :title="t('appointments.settings.booking.title')" :description="t('appointments.settings.booking.hint')" :can-edit="canEdit" data-testid="appointments-booking" @save="submit" @revert="revert" @reload="reload">
    <UFormField v-for="key in fields" :key="key" orientation="horizontal" :label="t(`appointments.settings.booking.${key}.label`)" :name="key" :description="t(`appointments.settings.booking.${key}.hint`)" :error="errorOf(key)">
      <UInputNumber :id="`appointments-${key}`" v-model="draft[key]" class="w-full" :min="APPOINTMENT_RANGES[key].min" :max="APPOINTMENT_RANGES[key].max" :disabled="locked" />
    </UFormField>
  </SharedSettingsCard>
</template>
