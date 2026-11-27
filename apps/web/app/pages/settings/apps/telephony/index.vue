<script setup lang="ts">
import TelephonyRecordingCard from '@/components/telephony/TelephonyRecordingCard.vue'
import { useTelephonySettings } from '@/composables/useTelephonySettings'

/**
 * The telephony application's settings under Settings > Applications (design section 8). The parts come from the
 * manifest: the lines, the routing, the extensions and the recording. Reading needs `telephony.use`, and every part
 * needs `telephony.manage`; a user with neither sees the forbidden state.
 */
const { t } = useI18n()
const { can } = useAccess()
const { parts, shows } = useSettingsPage('telephony')
const settings = useTelephonySettings()

async function reloadSettings() {
  const result = await settings.refetch()
  if (result.isError) throw result.error
  if (!result.data) throw new Error(t('errors.generic'))
  return result.data
}
</script>

<template>
  <SharedSettingsPage>
    <SharedPageHeader :title="t('telephony.title')" />
    <SharedForbiddenState v-if="!parts.length" :description="t('errors.forbidden')" />
    <template v-else>
      <section v-if="shows('recording')" id="recording" class="liwan-settings-anchor">
        <SharedPageState
          empty-icon="i-lucide-settings"
          :loading="settings.isLoading.value"
          :error="settings.data.value ? null : settings.error.value"
          :empty="!settings.data.value"
          @retry="settings.refetch"
        >
          <TelephonyRecordingCard
            v-if="settings.data.value"
            :settings="settings.data.value"
            :can-edit="can('telephony.manage')"
            :reload-settings="reloadSettings"
          />
        </SharedPageState>
      </section>
    </template>
  </SharedSettingsPage>
</template>
