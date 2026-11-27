<script setup lang="ts">
import MaintenanceBookingForm from '@/components/settings/MaintenanceBookingForm.vue'
import { useMaintenance, useMaintenanceActions } from '@/composables/useMaintenance'

// Book maintenance: the route-backed create panel over the system settings page (owner decision 2026-11-27).
const backTo = '/settings/system#maintenance'
const router = useRouter()
const { t } = useI18n()
const { shows } = useSettingsPage('system')
const canAccess = computed(() => shows('maintenance'))
const { data, isLoading, error, refetch } = useMaintenance(() => canAccess.value)
const { booking } = useMaintenanceActions()
</script>

<template>
  <SharedCreatePanel :title="t('settings.maintenance.newBooking')" :back-to="backTo">
    <SharedForbiddenState v-if="!canAccess" :description="t('settings.forbidden')" />
    <template v-else>
      <MaintenanceBookingForm v-if="data" :snapshot="data" :book="value => booking.mutateAsync(value)" @done="router.replace(backTo)" @cancel="router.push(backTo)" />
      <SharedPageState v-else :loading="isLoading" :error="error" @retry="refetch()" />
    </template>
  </SharedCreatePanel>
</template>
