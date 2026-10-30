<script setup lang="ts">
import IntegrationConnections from '@/components/settings/IntegrationConnections.vue'
import MaintenanceSettings from '@/components/settings/MaintenanceSettings.vue'
import { useMaintenance, useMaintenanceActions } from '@/composables/useMaintenance'

// The system settings: integrations (read-only) and maintenance, each a card hidden from a user who lacks its capability.
const { t } = useI18n()
const { parts, shows } = useSettingsPage('system')
const { data, isLoading, error, refetch } = useMaintenance(() => shows('maintenance'))
const { preference, booking, update } = useMaintenanceActions()
async function reloadSnapshot() {
  const { data: snapshot, error: failure } = await refetch()
  if (!snapshot) throw failure
  return snapshot
}
</script>

<template>
  <SharedSettingsPage width="form">
    <SharedPageHeader :title="t('settings.sections.system.title')" />
    <SharedForbiddenState v-if="!parts.length" :description="t('settings.forbidden')" />
    <template v-else>
      <IntegrationConnections v-if="shows('integrations')" />
      <SharedPageState v-if="shows('maintenance')" :loading="isLoading" :error="error" @retry="refetch()">
        <MaintenanceSettings v-if="data" :snapshot="data" :reload="reloadSnapshot" :save-preference="value => preference.mutateAsync(value)" :book="value => booking.mutateAsync(value)" :update-booking="(id, value) => update.mutateAsync({ id, value })" />
      </SharedPageState>
    </template>
  </SharedSettingsPage>
</template>
