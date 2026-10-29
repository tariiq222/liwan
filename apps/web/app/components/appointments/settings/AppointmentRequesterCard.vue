<script setup lang="ts">
import type { AppointmentSettings } from '@webvue/contracts'
import { requesterDraft, settingsPatch, type RequesterDraft } from '@/composables/appointments/appointmentSettings'
import { useSaveAppointmentSettings } from '@/composables/appointments/useAppointmentSettings'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'

// What the requester is asked for and may do: which contact fields are required, optional or hidden, whether the
// appointment waits for the requester's confirmation, and whether anyone may book or only invited requesters.
const props = defineProps<{ settings: AppointmentSettings; canEdit: boolean; reloadSettings: () => Promise<AppointmentSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { mutateAsync: saveSettings } = useSaveAppointmentSettings()
const { draft, state, save, revert, reload } = useSettingsForm<AppointmentSettings, RequesterDraft>({
  source: () => props.settings,
  read: requesterDraft,
  save: async (values, latest) => {
    const saved = await saveSettings(settingsPatch(latest, values))
    toast.add({ title: t('appointments.settings.saved'), color: 'success' })
    return saved
  },
  reload: () => props.reloadSettings(),
})
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading)
const requirementItems = computed(() => (['required', 'optional', 'hidden'] as const).map(value => ({ value, label: t(`appointments.settings.requester.requirement.${value}`) })))
const policyItems = computed(() => (['invite_only', 'open'] as const).map(value => ({ value, label: t(`appointments.settings.requester.policy.${value}`) })))
const fieldKeys = ['phone_field', 'email_field', 'national_id_field', 'notes_field'] as const
</script>

<template>
  <SharedSettingsCard id="requester" v-bind="state" :title="t('appointments.settings.requester.title')" :description="t('appointments.settings.requester.hint')" :can-edit="canEdit" data-testid="appointments-requester" @save="save" @revert="revert" @reload="reload">
    <UFormField orientation="horizontal" :label="t('appointments.settings.requester.selfBooking')" name="self_booking_policy" :description="t('appointments.settings.requester.selfBookingHint')">
      <USelect id="appointments-self-booking" v-model="draft.self_booking_policy" class="w-full" :items="policyItems" :disabled="locked" />
    </UFormField>
    <UFormField orientation="horizontal" :label="t('appointments.settings.requester.confirmation')" :description="t('appointments.settings.requester.confirmationHint')">
      <USwitch id="appointments-confirmation" v-model="draft.requester_confirmation" :disabled="locked" :aria-label="t('appointments.settings.requester.confirmation')" />
    </UFormField>
    <UFormField v-for="key in fieldKeys" :key="key" orientation="horizontal" :label="t(`appointments.settings.requester.fields.${key}`)" :name="key">
      <USelect :id="`appointments-${key}`" v-model="draft[key]" class="w-full" :items="requirementItems" :disabled="locked" />
    </UFormField>
  </SharedSettingsCard>
</template>
