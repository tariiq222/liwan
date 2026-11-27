<script setup lang="ts">
import MaintenanceBookingForm from '@/components/settings/MaintenanceBookingForm.vue'
import { useMaintenance, useMaintenanceActions } from '@/composables/useMaintenance'

// Edit one maintenance booking (owner decision 2026-11-27): a page of its own hosting the shared form.
const backTo = '/settings/system#maintenance'
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const { shows } = useSettingsPage('system')
const canAccess = computed(() => shows('maintenance'))
const bookingId = computed(() => {
  const raw = typeof route.params.bookingId === 'string' ? route.params.bookingId : ''
  if (!/^\d+$/.test(raw)) return null
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
})
const { data, isLoading, error: loadError, refetch } = useMaintenance(() => canAccess.value && bookingId.value !== null)
const booking = computed(() => {
  if (bookingId.value === null) return null
  const found = data.value?.bookings.items.find(item => item.id === bookingId.value) ?? null
  return found && found.status === 'scheduled' ? found : null
})
const loading = computed(() => bookingId.value !== null && isLoading.value)
const error = computed(() => {
  if (bookingId.value === null) return { status: 404 }
  if (loadError.value) return loadError.value
  if (!isLoading.value && data.value && !booking.value) return { status: 404 }
  return null
})
function retry() {
  if (!hydrated.value) return
  void refetch()
}
const { update } = useMaintenanceActions()
</script>

<template>
  <SharedPageContainer>
    <SharedPageHeader :title="t('settings.maintenance.editBooking')" :back-to="backTo" :back-label="t('settings.maintenance.title')" />
    <SharedForbiddenState v-if="!canAccess" :description="t('settings.forbidden')" />
    <SharedPageState v-else :loading="loading" :error="error" @retry="retry">
      <MaintenanceBookingForm v-if="booking && data" :key="booking.id" :booking="booking" :snapshot="data" :update-booking="(id, value) => update.mutateAsync({ id, value })" @done="router.replace(backTo)" @cancel="router.push(backTo)" />
    </SharedPageState>
  </SharedPageContainer>
</template>
