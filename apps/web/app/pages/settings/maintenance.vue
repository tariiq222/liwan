<script setup lang="ts">
import MaintenanceSettings from '@/components/settings/MaintenanceSettings.vue'
import { useMaintenance, useMaintenanceActions } from '@/composables/useMaintenance'

const { t } = useI18n()
const { can } = useAccess()
const forbidden = computed(() => !can('settings.maintenance.manage'))
const { data, isLoading, error, refetch } = useMaintenance(computed(() => !forbidden.value))
const { preference, booking, update } = useMaintenanceActions()
</script>

<template>
  <SharedSettingsPage width="form">
    <SharedPageHeader :title="t('settings.maintenance.title')" />
    <SharedForbiddenState v-if="forbidden" :description="t('settings.forbidden')" />
    <SharedPageState v-else :loading="isLoading" :error="error" @retry="refetch()">
      <MaintenanceSettings v-if="data" :snapshot="data" :reload="() => refetch()" :save-preference="value => preference.mutateAsync(value)" :book="value => booking.mutateAsync(value)" :update-booking="(id, value) => update.mutateAsync({ id, value })" />
    </SharedPageState>
  </SharedSettingsPage>
</template>
