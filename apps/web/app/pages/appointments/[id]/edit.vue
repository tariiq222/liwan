<script setup lang="ts">
import SharedDateField from '@liwan/ui/app/components/shared/form/DateField.vue'
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import { useAppointmentBooking, useAppointmentBookingMutation } from '@/composables/appointments/useAppointments'

// Rescheduling one booking: the start is the only field, because that is what the schedule route changes. The record
// keeps its requester, type and reason; cancelling and re-booking would lose them.
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const id = computed(() => {
  const value = Number(route.params.id)
  return Number.isSafeInteger(value) && value > 0 ? value : null
})
const backTo = computed(() => safeReturnTo(route.query.returnTo, `/appointments/${id.value ?? ''}`, ['/appointments']))
const booking = useAppointmentBooking(id, computed(() => hydrated.value && can('appointments.bookings.read')))
const mutation = useAppointmentBookingMutation()

// The local day and time the record holds, split for the two inputs; a booking with no time starts empty.
const day = ref('')
const time = ref('')
watch(() => booking.data.value, (record) => {
  if (!record?.start) return
  const date = new Date(record.start)
  day.value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  time.value = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}, { immediate: true })

const start = computed(() => day.value && time.value ? `${day.value}T${time.value}` : '')
const failure = ref<string | null>(null)
const saving = computed(() => mutation.isPending.value)
const dirty = computed(() => {
  const record = booking.data.value
  if (!record?.start) return Boolean(day.value && time.value)
  const current = new Date(record.start)
  return start.value !== `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}T${String(current.getHours()).padStart(2, '0')}:${String(current.getMinutes()).padStart(2, '0')}`
})

async function save() {
  if (!hydrated.value || saving.value || !id.value || !start.value) return
  failure.value = null
  try {
    const iso = new Date(start.value).toISOString()
    await mutation.mutateAsync({ action: 'schedule', id: id.value, body: { start: iso } })
    await navigateTo(backTo.value)
  } catch (cause) {
    failure.value = cause instanceof Error ? cause.message : t('errors.generic')
  }
}
</script>

<template>
  <SharedRecordPage :title="t('appointments.record.reschedule')" :back-to="backTo">
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedPageState :loading="booking.isLoading.value" :error="booking.error.value" :empty="!booking.data.value && !booking.isLoading.value && !booking.error.value" :empty-text="t('appointments.record.notFound')" @retry="booking.refetch()">
      <form v-if="booking.data.value" class="liwan-form" novalidate @submit.prevent="save">
        <SharedRecordSection variant="panel" :title="booking.data.value.requester_name">
          <div class="liwan-auto-grid gap-4">
            <UFormField :label="t('appointments.record.day')" name="appointments-day" required>
              <SharedDateField :model-value="day" :disabled="!hydrated || saving" data-testid="appointments-edit-day" @update:model-value="value => { day = value ?? '' }" />
            </UFormField>
            <UFormField :label="t('appointments.record.time')" name="appointments-time" required>
              <UInput v-model="time" type="time" class="w-full" :disabled="!hydrated || saving" data-testid="appointments-edit-time" />
            </UFormField>
          </div>
          <UAlert v-if="failure" role="alert" color="error" variant="subtle" :title="failure" class="mt-4" data-testid="appointments-edit-error" />
          <SharedFormActions>
            <div class="ms-auto flex flex-wrap items-center gap-2">
              <UButton type="button" color="neutral" variant="outline" :to="backTo" :disabled="saving" :label="t('app.cancel')" />
              <UButton type="submit" :disabled="!hydrated || saving || !start" :loading="saving" :label="t('app.save')" data-testid="appointments-edit-save" />
            </div>
          </SharedFormActions>
        </SharedRecordSection>
      </form>
    </SharedPageState>
  </SharedRecordPage>
</template>
