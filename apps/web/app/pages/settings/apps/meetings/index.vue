<script setup lang="ts">
import MeetingScheduleCard from '@/components/meetings/MeetingScheduleCard.vue'
import { useMeetingSettings } from '@/composables/useMeetingSettings'

// The meetings application's settings, one page of cards under Settings > Applications. Reading and changing them
// needs `meetings.settings.manage`; a holder of it sees every part.
const { t } = useI18n()
const { parts, shows } = useSettingsPage('meetings')
const settings = useMeetingSettings(() => shows('schedule'))
async function reloadSettings() {
  const result = await settings.refetch()
  if (result.isError) throw result.error
  if (!result.data) throw new Error(t('errors.generic'))
  return result.data
}
</script>

<template>
  <SharedSettingsPage width="form">
    <SharedPageHeader :title="t('nav.meetings')" />
    <SharedForbiddenState v-if="!parts.length" :description="t('errors.forbidden')" />
    <template v-else>
      <section v-if="shows('schedule')" id="schedule" class="webvue-settings-anchor">
        <SharedPageState :loading="settings.isLoading.value" :error="settings.data.value ? null : settings.error.value" :empty="!settings.data.value" @retry="settings.refetch()">
          <MeetingScheduleCard v-if="settings.data.value" :settings="settings.data.value" :reload-settings="reloadSettings" />
        </SharedPageState>
      </section>
    </template>
  </SharedSettingsPage>
</template>
