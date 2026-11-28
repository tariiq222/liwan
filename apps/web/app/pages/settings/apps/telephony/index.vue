<script setup lang="ts">
import TelephonyExtensionsCard from '@/components/telephony/TelephonyExtensionsCard.vue'
import TelephonyRecordingSettingsCard from '@/components/telephony/TelephonyRecordingSettingsCard.vue'

/**
 * The telephony application's settings under Settings > Applications. Two parts: the extensions, as the list of the
 * company's extensions and the row that adds one, and the recording settings. Managing either needs `telephony.manage`;
 * a user without it sees the forbidden state.
 */
const { t } = useI18n()
const { can } = useAccess()
const { parts, shows } = useSettingsPage('telephony')
const canManage = computed(() => can('telephony.manage'))
</script>

<template>
  <SharedSettingsPage>
    <SharedPageHeader :title="t('telephony.title')" />
    <SharedForbiddenState v-if="!parts.length" :description="t('errors.forbidden')" />
    <template v-else>
      <TelephonyExtensionsCard v-if="shows('extensions')" id="extensions" :can-edit="canManage" />
      <TelephonyRecordingSettingsCard v-if="shows('recording')" id="recording" :can-edit="canManage" />
    </template>
  </SharedSettingsPage>
</template>
