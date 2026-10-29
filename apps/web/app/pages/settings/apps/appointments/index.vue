<script setup lang="ts">
import AppointmentBookingCard from '@/components/appointments/settings/AppointmentBookingCard.vue'
import AppointmentPresetCard from '@/components/appointments/settings/AppointmentPresetCard.vue'
import AppointmentRequesterCard from '@/components/appointments/settings/AppointmentRequesterCard.vue'
import { useAppointmentSettings } from '@/composables/appointments/useAppointmentSettings'

// The appointment policy of the company: a sector preset, the booking timing rules and what the requester is asked for.
// Every part is shown to the holder of `appointments.bookings.manage` only.
const { t } = useI18n()
const { can } = useAccess()
const { parts, shows } = useSettingsPage('appointments')
const settings = useAppointmentSettings(() => parts.value.length > 0)
const canEdit = computed(() => can('appointments.bookings.manage'))
async function reloadSettings() {
  const result = await settings.refetch()
  if (result.isError) throw result.error
  if (!result.data) throw new Error(t('errors.generic'))
  return result.data
}
</script>

<template>
  <SharedSettingsPage width="form">
    <SharedPageHeader :title="t('appointments.settings.title')" />
    <SharedForbiddenState v-if="!parts.length" :description="t('errors.forbidden')" />
    <SharedPageState v-else-if="!settings.data.value" :loading="settings.isLoading.value" :error="settings.error.value" :empty="true" @retry="settings.refetch()" />
    <template v-else>
      <AppointmentPresetCard v-if="shows('preset')" :settings="settings.data.value" :can-edit="canEdit" :reload-settings="reloadSettings" />
      <AppointmentBookingCard v-if="shows('booking')" :settings="settings.data.value" :can-edit="canEdit" :reload-settings="reloadSettings" />
      <AppointmentRequesterCard v-if="shows('requester')" :settings="settings.data.value" :can-edit="canEdit" :reload-settings="reloadSettings" />
    </template>
  </SharedSettingsPage>
</template>
