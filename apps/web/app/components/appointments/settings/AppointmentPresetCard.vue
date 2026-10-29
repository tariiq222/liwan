<script setup lang="ts">
import type { AppointmentSettings } from '@webvue/contracts'
import { settingsPatch } from '@/composables/appointments/appointmentSettings'
import { useSaveAppointmentSettings } from '@/composables/appointments/useAppointmentSettings'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'

// The sector preset: one choice that sets the booking and requester values together. It is saved first-class (`preset`),
// so the server writes every value of the preset; the other cards then show the new values.
const props = defineProps<{ settings: AppointmentSettings; canEdit: boolean; reloadSettings: () => Promise<AppointmentSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { mutateAsync: saveSettings } = useSaveAppointmentSettings()
const { draft, state, save, revert, reload } = useSettingsForm<AppointmentSettings, { sector_preset: AppointmentSettings['sector_preset'] }>({
  source: () => props.settings,
  read: ({ sector_preset }) => ({ sector_preset }),
  save: async (values, latest) => {
    const saved = await saveSettings(settingsPatch(latest, { preset: values.sector_preset }))
    toast.add({ title: t('appointments.settings.saved'), color: 'success' })
    return saved
  },
  reload: () => props.reloadSettings(),
})
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading)
const items = computed(() => props.settings.presets.map(value => ({ value, label: t(`appointments.settings.presets.${value}`) })))
</script>

<template>
  <SharedSettingsCard id="preset" v-bind="state" :title="t('appointments.settings.preset.title')" :description="t('appointments.settings.preset.hint')" :can-edit="canEdit" data-testid="appointments-preset" @save="save" @revert="revert" @reload="reload">
    <UFormField orientation="horizontal" :label="t('appointments.settings.preset.label')" name="sector_preset" :description="t('appointments.settings.preset.warning')">
      <USelect id="appointments-preset" v-model="draft.sector_preset" class="w-full" :items="items" :disabled="locked" />
    </UFormField>
  </SharedSettingsCard>
</template>
