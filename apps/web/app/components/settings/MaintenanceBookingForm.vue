<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { saveErrorMessage } from '@/utils/formFeedback'
import {
  MaintenanceBookingInputSchema, MaintenanceBookingPatchSchema,
  type MaintenanceBooking, type MaintenanceBookingInput, type MaintenanceBookingPatch, type MaintenanceSnapshot,
} from '@liwan/contracts'

// The create/edit form of one maintenance booking (owner decision 2026-11-27): it lives on the route-backed
// /new panel and /[bookingId]/edit page, while MaintenanceSettings keeps the lists and the cancel confirmation.
const props = defineProps<{
  snapshot: MaintenanceSnapshot
  /** Absent on the /new route; present on the edit route, where the release is fixed and the preference checkbox is hidden. */
  booking?: MaintenanceBooking
  book?: (value: MaintenanceBookingInput) => Promise<unknown>
  updateBooking?: (id: number, value: MaintenanceBookingPatch) => Promise<unknown>
}>()
const emit = defineEmits<{ done: []; cancel: [] }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const formId = `maintenance-booking-${useId()}`
const releaseId = ref<number | undefined>(props.booking?.releaseId)
const localDateTime = ref('')
const bookingTimezone = ref(props.booking?.timezone ?? 'UTC')
const bookingDuration = ref(props.booking?.durationMinutes ?? 60)
const usePreference = ref(false)
const attempted = ref(false)
const failure = ref('')
const busy = ref(false)
const locked = computed(() => !hydrated.value || busy.value)
// A successful save disarms the unsaved-changes guard, so the shared guard never blocks the navigation it caused.
const saved = ref(false)
// A booking's local time read in its own zone; the edit page mounts the form per booking through `:key`.
const readLocalTime = (booking: MaintenanceBooking) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: booking.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(booking.scheduledAt))
  const part = (name: string) => parts.find(item => item.type === name)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`
}
if (props.booking) localDateTime.value = readLocalTime(props.booking)
const baseline = { releaseId: releaseId.value, localDateTime: localDateTime.value, timezone: bookingTimezone.value, duration: Number(bookingDuration.value), usePreference: usePreference.value }
const dirty = computed(() => !saved.value && (releaseId.value !== baseline.releaseId || localDateTime.value !== baseline.localDateTime || bookingTimezone.value !== baseline.timezone || Number(bookingDuration.value) !== baseline.duration || usePreference.value !== baseline.usePreference))
// In create mode the draft timezone follows the saved window until the reader touches a field; an edit keeps its own zone.
watch(() => props.snapshot.preference, (value) => {
  if (props.booking || dirty.value) return
  bookingTimezone.value = value?.timezone ?? 'UTC'
  baseline.timezone = bookingTimezone.value
}, { immediate: true })
const timezone = computed(() => props.snapshot.preference?.timezone ?? 'UTC')
const deadlinePassed = (item: { deadlineAt: string }) => new Date(item.deadlineAt).getTime() <= Date.now()
const available = computed(() => props.snapshot.releases.items.filter(item => item.scope === 'tenant' && item.status === 'supported' && !deadlinePassed(item) && !props.snapshot.bookings.items.some(booking => booking.releaseId === item.id && booking.status !== 'cancelled')))
const releaseItems = computed(() => props.snapshot.releases.items
  .filter(item => props.booking ? item.id === props.booking.releaseId : available.value.includes(item))
  .map(item => ({ value: item.id, label: item.releaseId })))
const release = computed(() => props.snapshot.releases.items.find(item => item.id === releaseId.value))
const value = computed(() => {
  const time = { localDateTime: localDateTime.value, timezone: bookingTimezone.value, durationMinutes: Number(bookingDuration.value) }
  if (props.booking) return { ...time, revision: props.booking.revision }
  return usePreference.value
    ? { releaseId: releaseId.value, usePreference: true as const, preferenceRevision: props.snapshot.preference?.revision ?? 0 }
    : { ...time, releaseId: releaseId.value }
})
const parsed = computed(() => (props.booking ? MaintenanceBookingPatchSchema.safeParse(value.value) : MaintenanceBookingInputSchema.safeParse(value.value)))
const releaseError = computed(() => {
  if (!attempted.value || props.booking) return undefined
  return releaseId.value && releaseItems.value.some(item => item.value === releaseId.value) ? undefined : t('settings.maintenance.releaseRequired')
})
const timeError = computed(() => {
  if (!attempted.value || usePreference.value) return undefined
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localDateTime.value) ? undefined : t('settings.maintenance.timeRequired')
})
const zoneError = computed(() => {
  if (!attempted.value || usePreference.value) return undefined
  try { new Intl.DateTimeFormat('en', { timeZone: bookingTimezone.value }); return undefined } catch { return t('settings.maintenance.zoneInvalid') }
})
const durationError = computed(() => {
  if (!attempted.value || usePreference.value) return undefined
  const minutes = Number(bookingDuration.value)
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440 ? undefined : t('settings.maintenance.durationInvalid')
})
const generalError = computed(() => failure.value || (attempted.value && (!parsed.value.success || Boolean(releaseError.value || timeError.value || zoneError.value || durationError.value)) ? t('settings.maintenance.invalid') : ''))
function focusFirstInvalid() {
  if (typeof document === 'undefined') return
  const first = [releaseError.value && 'maintenance-release', timeError.value && 'maintenance-booking-time', zoneError.value && 'maintenance-booking-zone', durationError.value && 'maintenance-booking-duration'].find(Boolean)
  if (typeof first === 'string') document.getElementById(first)?.focus()
}
async function saveBooking() {
  if (locked.value) return
  attempted.value = true
  failure.value = ''
  saved.value = false
  if (!parsed.value.success || releaseError.value || timeError.value || zoneError.value || durationError.value) { focusFirstInvalid(); return }
  busy.value = true
  try {
    if (props.booking) {
      if (!props.updateBooking) return
      await props.updateBooking(props.booking.id, parsed.value.data as MaintenanceBookingPatch)
    } else {
      if (!props.book) return
      await props.book(parsed.value.data as MaintenanceBookingInput)
    }
    saved.value = true
    emit('done')
  } catch (cause) { failure.value = saveErrorMessage(cause, t('errors.generic'), t('errors.saveUncertain')) } finally { busy.value = false }
}
function formatDate(date: string, zone = timezone.value) {
  try { return new Intl.DateTimeFormat(locale.value, { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date)) } catch { return date }
}
</script>

<template>
  <form :id="formId" class="liwan-form" novalidate data-testid="maintenance-booking-form" @submit.prevent="saveBooking">
    <SharedUnsavedChanges :dirty="dirty" />
    <UAlert v-if="generalError" data-testid="maintenance-error" role="alert" color="error" variant="subtle" :title="generalError" :description="failure ? t('settings.maintenance.keepDraft') : undefined" />
    <SharedFormSection panel :title="t(props.booking ? 'settings.maintenance.editBooking' : 'settings.maintenance.newBooking')">
      <UFormField :label="t('settings.maintenance.release')" name="release" required :error="releaseError">
        <USelect id="maintenance-release" v-model="releaseId" data-testid="maintenance-release" :items="releaseItems" :disabled="locked || !!props.booking" />
      </UFormField>
      <UCheckbox v-if="!props.booking" v-model="usePreference" :label="t('settings.maintenance.usePreference')" :disabled="locked || !props.snapshot.preference" />
      <template v-if="!usePreference">
        <UFormField :label="t('settings.maintenance.localTime')" name="localDateTime" required :error="timeError" :help="t('settings.maintenance.dstHint')">
          <UInput id="maintenance-booking-time" v-model="localDateTime" data-testid="maintenance-booking-time" type="datetime-local" dir="ltr" :disabled="locked" />
        </UFormField>
        <UFormField :label="t('settings.maintenance.timezone')" name="bookingTimezone" required :error="zoneError">
          <UInput id="maintenance-booking-zone" v-model="bookingTimezone" data-testid="maintenance-booking-zone" dir="ltr" :disabled="locked" />
        </UFormField>
        <UFormField :label="t('settings.maintenance.duration')" name="bookingDuration" required :error="durationError">
          <UInput id="maintenance-booking-duration" v-model="bookingDuration" data-testid="maintenance-booking-duration" type="number" :min="1" :max="1440" :disabled="locked" />
        </UFormField>
      </template>
      <UAlert v-if="release" color="info" :title="t('settings.maintenance.deadline', { date: formatDate(release.deadlineAt), zone: timezone })" :description="release.policy" />
    </SharedFormSection>
    <SharedFormActions>
      <div class="ms-auto flex flex-wrap items-center gap-2">
        <UButton type="button" color="neutral" variant="outline" :disabled="busy" :label="t('app.cancel')" @click="emit('cancel')" />
        <UButton type="submit" :form="formId" :disabled="locked" :loading="busy" :label="t('settings.maintenance.confirmBooking')" />
      </div>
    </SharedFormActions>
  </form>
</template>
