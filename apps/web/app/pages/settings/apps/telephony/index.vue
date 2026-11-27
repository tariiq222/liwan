<script setup lang="ts">
import TelephonyExtensionsCard from '@/components/telephony/TelephonyExtensionsCard.vue'

/**
 * The telephony application's settings under Settings > Applications. One part: the extensions, as the list of the
 * company's extensions and the row that adds one. Reading and creating both need `telephony.manage`; a user without it
 * sees the forbidden state.
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
    <TelephonyExtensionsCard v-else-if="shows('extensions')" id="extensions" :can-edit="canManage" />
  </SharedSettingsPage>
</template>
