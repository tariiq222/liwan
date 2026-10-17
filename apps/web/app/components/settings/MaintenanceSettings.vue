<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  MaintenanceBookingInputSchema, MaintenanceBookingPatchSchema, MaintenancePreferencePatchSchema,
  type MaintenanceBooking, type MaintenanceBookingInput, type MaintenanceBookingPatch,
  type MaintenancePreference, type MaintenancePreferencePatch, type MaintenanceSnapshot,
} from '@webvue/contracts'

const props = defineProps<{
  snapshot: MaintenanceSnapshot
  pending?: boolean
  reload?: () => Promise<unknown>
  savePreference: (value: MaintenancePreferencePatch) => Promise<MaintenancePreference>
  book: (value: MaintenanceBookingInput) => Promise<unknown>
  updateBooking: (id: number, value: MaintenanceBookingPatch) => Promise<unknown>
}>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const timezone = ref('UTC')
const weekday = ref(4)
const startMinute = ref(120)
const startTime = computed({ get: () => `${String(Math.floor(startMinute.value / 60)).padStart(2, '0')}:${String(startMinute.value % 60).padStart(2, '0')}`, set: (value: string) => { const [hour, minute] = value.split(':').map(Number); startMinute.value = hour! * 60 + minute! } })
const duration = ref(60)
const preferenceRevision = ref(0)
const preferenceDirty = ref(false)
const releaseId = ref<number | undefined>()
const localDateTime = ref('')
const bookingTimezone = ref('UTC')
const bookingDuration = ref(60)
const usePreference = ref(false)
const bookingDirty = ref(false)
const editing = ref<MaintenanceBooking | null>(null)
const cancelTarget = ref<MaintenanceBooking | null>(null)
const error = ref('')
const busy = ref(false)
const disabled = computed(() => !hydrated.value || busy.value || props.pending)
const dirty = computed(() => preferenceDirty.value || bookingDirty.value)
const release = computed(() => props.snapshot.releases.items.find(item => item.id === releaseId.value))
const available = computed(() => props.snapshot.releases.items.filter(item => item.scope === 'tenant' && item.status === 'supported' && !props.snapshot.bookings.items.some(booking => booking.releaseId === item.id && booking.status !== 'cancelled')))
const editingAllowed = computed(() => !editing.value || props.snapshot.bookings.items.find(item => item.id === editing.value?.id)?.status === 'scheduled')
const weekdays = computed(() => Array.from({ length: 7 }, (_, value) => ({ value, label: t(`settings.maintenance.weekdays.${value}`) })))
const releaseItems = computed(() => props.snapshot.releases.items.filter(item => available.value.includes(item) || item.id === editing.value?.releaseId).map(item => ({ value: item.id, label: item.releaseId })))

function loadPreference(value: MaintenancePreference | null) {
  timezone.value = value?.timezone ?? 'UTC'
  weekday.value = value?.weekday ?? 4
  startMinute.value = value?.startMinute ?? 120
  duration.value = value?.durationMinutes ?? 60
  preferenceRevision.value = value?.revision ?? 0
  preferenceDirty.value = false
}
watch(() => props.snapshot.preference, value => {
  if (!preferenceDirty.value) loadPreference(value)
  if (!bookingDirty.value) bookingTimezone.value = value?.timezone ?? 'UTC'
}, { immediate: true })
function message(cause: unknown) {
  return cause instanceof Error ? cause.message : t('errors.generic')
}
async function savePreference() {
  if (disabled.value) return
  error.value = ''
  const parsed = MaintenancePreferencePatchSchema.safeParse({ timezone: timezone.value, weekday: Number(weekday.value), startMinute: Number(startMinute.value), durationMinutes: Number(duration.value), revision: preferenceRevision.value })
  if (!parsed.success) { error.value = t('settings.maintenance.invalid'); return }
  busy.value = true
  try { loadPreference(await props.savePreference(parsed.data)) } catch (cause) { error.value = message(cause) } finally { busy.value = false }
}
async function saveBooking() {
  if (disabled.value) return
  error.value = ''
  const time = { localDateTime: localDateTime.value, timezone: bookingTimezone.value, durationMinutes: Number(bookingDuration.value) }
  const value = editing.value ? { ...time, revision: editing.value.revision } : usePreference.value
    ? { releaseId: releaseId.value, usePreference: true as const, preferenceRevision: props.snapshot.preference?.revision ?? 0 }
    : { ...time, releaseId: releaseId.value }
  const parsed = editing.value ? MaintenanceBookingPatchSchema.safeParse(value) : MaintenanceBookingInputSchema.safeParse(value)
  if (!parsed.success) { error.value = t('settings.maintenance.invalid'); return }
  busy.value = true
  try {
    if (editing.value) await props.updateBooking(editing.value.id, parsed.data as MaintenanceBookingPatch)
    else await props.book(parsed.data as MaintenanceBookingInput)
    editing.value = null; bookingDirty.value = false; localDateTime.value = ''
  } catch (cause) { error.value = message(cause) } finally { busy.value = false }
}
function editBooking(booking: MaintenanceBooking) {
  if (disabled.value || bookingDirty.value) return
  editing.value = { ...booking }
  releaseId.value = booking.releaseId
  bookingTimezone.value = booking.timezone
  bookingDuration.value = booking.durationMinutes
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: booking.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(booking.scheduledAt))
  const part = (name: string) => parts.find(item => item.type === name)?.value ?? ''
  localDateTime.value = `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`
  usePreference.value = false
  bookingDirty.value = true
}
async function cancelBooking() {
  if (disabled.value || !cancelTarget.value) return
  busy.value = true; error.value = ''
  try {
    await props.updateBooking(cancelTarget.value.id, { status: 'cancelled', revision: cancelTarget.value.revision })
    cancelTarget.value = null
  } catch (cause) { error.value = message(cause) } finally { busy.value = false }
}
function formatDate(value: string, zone = timezone.value) {
  try { return new Intl.DateTimeFormat(locale.value, { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) } catch { return value }
}
function resetBooking() {
  editing.value = null; bookingDirty.value = false; localDateTime.value = ''; error.value = ''
}
</script>

<template>
  <div class="space-y-8">
    <SharedUnsavedChanges :dirty="dirty" />
    <UAlert v-if="error" data-testid="maintenance-error" color="error" :title="error" :description="t('settings.maintenance.keepDraft')">
      <template v-if="reload" #actions><UButton type="button" color="neutral" variant="outline" :disabled="disabled" @click="reload()">{{ t('app.retry') }}</UButton></template>
    </UAlert>
    <form data-testid="maintenance-preference-form" class="webvue-form" @submit.prevent="savePreference">
      <SharedFormSection panel :title="t('settings.maintenance.preference')" :description="t('settings.maintenance.preferenceHint')">
        <UFormField :label="t('settings.maintenance.timezone')" name="timezone">
          <UInput v-model="timezone" data-testid="maintenance-timezone" :disabled="disabled" dir="ltr" @update:model-value="preferenceDirty = true" />
        </UFormField>
        <UFormField :label="t('settings.maintenance.weekday')" name="weekday">
          <USelect v-model="weekday" :items="weekdays" :disabled="disabled" @update:model-value="preferenceDirty = true" />
        </UFormField>
        <UFormField :label="t('settings.maintenance.startTime')" name="startTime">
          <UInput v-model="startTime" type="time" dir="ltr" :disabled="disabled" @update:model-value="preferenceDirty = true" />
        </UFormField>
        <UFormField :label="t('settings.maintenance.duration')" name="duration">
          <UInput v-model="duration" type="number" :min="1" :max="1440" :disabled="disabled" @update:model-value="preferenceDirty = true" />
        </UFormField>
      </SharedFormSection>
      <SharedFormActions>
        <UButton type="button" color="neutral" variant="outline" :disabled="disabled || !preferenceDirty" @click="loadPreference(snapshot.preference)">{{ t('settings.maintenance.discard') }}</UButton>
        <UButton type="submit" data-testid="maintenance-preference-save" :disabled="disabled" :loading="busy">{{ t('app.save') }}</UButton>
      </SharedFormActions>
    </form>
    <SharedRecordSection variant="list" :title="t('settings.maintenance.releases')">
      <p v-if="!snapshot.releases.items.length" class="p-(--webvue-card-pad) text-sm text-muted">{{ t('settings.maintenance.noReleases') }}</p>
      <article v-for="notice in snapshot.releases.items" :key="notice.id" class="space-y-2 p-(--webvue-card-pad)">
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="font-semibold" dir="ltr">{{ notice.releaseId }}</h3>
          <SharedStatusBadge tone="neutral" :label="t(`settings.maintenance.scope.${notice.scope}`)" />
          <SharedStatusBadge tone="neutral" :label="t(`settings.maintenance.releaseStatus.${notice.status}`)" />
          <SharedStatusBadge v-if="notice.urgency === 'security'" tone="warning" :label="t('settings.maintenance.security')" />
        </div>
        <p>{{ t('settings.maintenance.deadline', { date: formatDate(notice.deadlineAt), zone: timezone }) }}</p>
        <p>{{ t('settings.maintenance.estimate', { seconds: notice.estimatedSeconds }) }}</p>
        <p class="whitespace-pre-wrap">{{ notice.policy }}</p>
        <p v-if="notice.scope !== 'tenant'" class="text-muted">{{ t('settings.maintenance.sharedScope') }}</p>
      </article>
    </SharedRecordSection>
    <form v-if="available.length || editing" class="webvue-form" data-testid="maintenance-booking-form" @submit.prevent="saveBooking">
      <SharedFormSection panel :title="t(editing ? 'settings.maintenance.editBooking' : 'settings.maintenance.newBooking')">
        <UFormField :label="t('settings.maintenance.release')" name="release">
          <USelect v-model="releaseId" data-testid="maintenance-release" :items="releaseItems" :disabled="disabled || !!editing" @update:model-value="bookingDirty = true" />
        </UFormField>
        <UCheckbox v-if="!editing" v-model="usePreference" :label="t('settings.maintenance.usePreference')" :disabled="disabled || !snapshot.preference || preferenceDirty" @update:model-value="bookingDirty = true" />
        <template v-if="!usePreference">
          <UFormField :label="t('settings.maintenance.localTime')" name="localDateTime" :help="t('settings.maintenance.dstHint')">
            <UInput v-model="localDateTime" data-testid="maintenance-booking-time" type="datetime-local" dir="ltr" :disabled="disabled" @update:model-value="bookingDirty = true" />
          </UFormField>
          <UFormField :label="t('settings.maintenance.timezone')" name="bookingTimezone">
            <UInput v-model="bookingTimezone" data-testid="maintenance-booking-zone" dir="ltr" :disabled="disabled" @update:model-value="bookingDirty = true" />
          </UFormField>
          <UFormField :label="t('settings.maintenance.duration')" name="bookingDuration">
            <UInput v-model="bookingDuration" data-testid="maintenance-booking-duration" type="number" :min="1" :max="1440" :disabled="disabled" @update:model-value="bookingDirty = true" />
          </UFormField>
        </template>
        <UAlert v-if="release" color="info" :title="t('settings.maintenance.deadline', { date: formatDate(release.deadlineAt), zone: timezone })" :description="release.policy" />
      </SharedFormSection>
      <SharedFormActions>
        <UButton type="button" color="neutral" variant="outline" :disabled="disabled" @click="resetBooking">{{ t('settings.maintenance.discard') }}</UButton>
        <UButton type="submit" :disabled="disabled || !releaseId || !editingAllowed || release?.status !== 'supported' || (usePreference && preferenceDirty)" :loading="busy">{{ t('settings.maintenance.confirmBooking') }}</UButton>
      </SharedFormActions>
    </form>
    <SharedRecordSection variant="list" :title="t('settings.maintenance.bookings')">
      <p v-if="!snapshot.bookings.items.length" class="p-(--webvue-card-pad) text-sm text-muted">{{ t('settings.maintenance.noBookings') }}</p>
      <article v-for="booking in snapshot.bookings.items" :key="booking.id" class="space-y-2 p-(--webvue-card-pad)">
        <h3 class="font-semibold">{{ snapshot.releases.items.find(item => item.id === booking.releaseId)?.releaseId ?? booking.releaseId }}</h3>
        <p>{{ formatDate(booking.scheduledAt, booking.timezone) }} · {{ booking.timezone }}</p>
        <p>{{ t('settings.maintenance.windowMinutes', { minutes: booking.durationMinutes }) }}</p>
        <SharedStatusBadge tone="neutral" :label="t(`settings.maintenance.status.${booking.status}`)" />
        <div v-if="booking.status === 'scheduled'" class="flex gap-2">
          <UButton type="button" color="neutral" variant="outline" :disabled="disabled || bookingDirty" :data-testid="`maintenance-edit-${booking.id}`" @click="editBooking(booking)">{{ t('settings.maintenance.editBooking') }}</UButton>
          <UButton type="button" color="error" variant="outline" :disabled="disabled" :data-testid="`maintenance-cancel-${booking.id}`" @click="cancelTarget = { ...booking }">{{ t('settings.maintenance.cancelBooking') }}</UButton>
        </div>
        <SharedInlineConfirm v-if="booking.status === 'scheduled' && cancelTarget?.id === booking.id" :title="t('settings.maintenance.confirmCancel')" :confirm-label="t('settings.maintenance.cancelBooking')" :pending="busy" :disabled="disabled" @confirm="cancelBooking" @cancel="cancelTarget = null" />
      </article>
    </SharedRecordSection>
  </div>
</template>
