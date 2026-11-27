<script setup lang="ts">
import MaintenanceSettings from '@/components/settings/MaintenanceSettings.vue'
import { useMaintenance, useMaintenanceActions } from '@/composables/useMaintenance'

// The system settings: storage and maintenance, each a card hidden from a user who lacks its capability. The
// maintenance create panel opens over the settings page itself (owner decision 2026-11-27); every other route
// (storage, export, a booking's edit page) renders alone as a sub-page.
const route = useRoute()
const { t } = useI18n()
const { parts, shows } = useSettingsPage('system')
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const isSubPage = computed(() => normalizedPath.value !== '/settings/system' && normalizedPath.value !== '/settings/system/maintenance/new')
const { data, isLoading, error, refetch } = useMaintenance(() => !isSubPage.value && shows('maintenance'))
const { preference, update } = useMaintenanceActions()
async function reloadSnapshot() {
  const { data: snapshot, error: failure } = await refetch()
  if (!snapshot) throw failure
  return snapshot
}
</script>

<template>
  <SharedSettingsPage v-if="!isSubPage">
    <SharedPageHeader :title="t('settings.sections.system.title')" />
    <SharedForbiddenState v-if="!parts.length" :description="t('settings.forbidden')" />
    <template v-else>
      <SharedRecordSection v-if="shows('storage')" id="storage" variant="panel" :title="t('settings.storage.title')" :description="t('settings.storage.description')">
        <UButton to="/settings/system/storage" color="neutral" variant="outline">{{ t('settings.storage.open') }}</UButton>
      </SharedRecordSection>
      <SharedPageState v-if="shows('maintenance')" :loading="isLoading" :error="error" @retry="refetch()">
        <MaintenanceSettings v-if="data" :snapshot="data" :reload="reloadSnapshot" :save-preference="value => preference.mutateAsync(value)" :update-booking="(id, value) => update.mutateAsync({ id, value })" />
      </SharedPageState>
    </template>
  </SharedSettingsPage>
  <NuxtPage />
</template>
