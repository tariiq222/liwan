<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ApiError } from '@/composables/useApi'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'
import {
  MaintenanceBookingInputSchema, MaintenanceBookingPatchSchema, MaintenancePreferencePatchSchema,
  type MaintenanceBooking, type MaintenanceBookingInput, type MaintenanceBookingPatch,
  type MaintenancePreference, type MaintenancePreferencePatch, type MaintenanceSnapshot,
} from '@liwan/contracts'

const props = defineProps<{
  snapshot: MaintenanceSnapshot
  pending?: boolean
  reload: () => Promise<MaintenanceSnapshot>
  savePreference: (value: MaintenancePreferencePatch) => Promise<MaintenancePreference>
  book: (value: MaintenanceBookingInput) => Promise<unknown>
  updateBooking: (id: number, value: MaintenanceBookingPatch) => Promise<unknown>
}>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
interface PreferenceDraft { timezone: string; weekday: number; startMinute: number; durationMinutes: number; saved: boolean }
const readPreference = (value: MaintenancePreference | null): PreferenceDraft => ({
  timezone: value?.timezone ?? 'UTC', weekday: value?.weekday ?? 4, startMinute: value?.startMinute ?? 120, durationMinutes: value?.durationMinutes ?? 60, saved: value !== null,
})
const { draft, state, save: savePreferenceDraft, revert, reload: reloadPreference } = useSettingsForm<MaintenancePreference | null, PreferenceDraft>({
  source: () => props.snapshot.preference,
  read: readPreference,
  save: (values, latest) => {
    const parsed = MaintenancePreferencePatchSchema.safeParse({ timezone: values.timezone, weekday: Number(values.weekday), startMinute: Number(values.startMinute), durationMinutes: Number(values.durationMinutes), revision: latest?.revision ?? 0 })
    if (!parsed.success) throw new ApiError(422, 'invalid', t('settings.maintenance.invalid'))
    return props.savePreference(parsed.data)
  },
  reload: async () => (await props.reload()).preference,
})
// No window is saved yet: the defaults shown are a proposal, so the card starts dirty and «Save» can confirm them.
if (!props.snapshot.preference) draft.value.saved = true
const startTime = computed({
  get: () => `${String(Math.floor(draft.value.startMinute / 60)).padStart(2, '0')}:${String(draft.value.startMinute % 60).padStart(2, '0')}`,
  set: (value: string) => { const [hour, minute] = value.split(':').map(Number); draft.value.startMinute = hour! * 60 + minute! },
})
// The saved window's zone formats the release deadlines; the draft only counts once it is saved.
const timezone = computed(() => props.snapshot.preference?.timezone ?? 'UTC')
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
const locked = computed(() => disabled.value || state.value.saving || state.value.reloading)
const dirty = computed(() => bookingDirty.value)
const release = computed(() => props.snapshot.releases.items.find(item => item.id === releaseId.value))
const deadlinePassed = (item: { deadlineAt: string }) => new Date(item.deadlineAt).getTime() <= Date.now()
const available = computed(() => props.snapshot.releases.items.filter(item => item.scope === 'tenant' && item.status === 'supported' && !deadlinePassed(item) && !props.snapshot.bookings.items.some(booking => booking.releaseId === item.id && booking.status !== 'cancelled')))
const editingAllowed = computed(() => !editing.value || props.snapshot.bookings.items.find(item => item.id === editing.value?.id)?.status === 'scheduled')
const weekdays = computed(() => Array.from({ length: 7 }, (_, value) => ({ value, label: t(`settings.maintenance.weekdays.${value}`) })))
const releaseItems = computed(() => props.snapshot.releases.items.filter(item => available.value.includes(item) || item.id === editing.value?.releaseId).map(item => ({ value: item.id, label: item.releaseId })))

watch(() => props.snapshot.preference, value => {
  if (!bookingDirty.value) bookingTimezone.value = value?.timezone ?? 'UTC'
}, { immediate: true })
function message(cause: unknown) {
  return cause instanceof Error ? cause.message : t('errors.generic')
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
  <div class="grid gap-(--liwan-gap-card)">
    <SharedUnsavedChanges :dirty="dirty" />
    <UAlert v-if="error" data-testid="maintenance-error" color="error" :title="error" :description="t('settings.maintenance.keepDraft')" />
    <SharedSettingsCard id="maintenance" v-bind="state" data-testid="maintenance-preference-form" :title="t('settings.maintenance.preference')" :description="t('settings.maintenance.preferenceHint')" :can-edit="true" @save="savePreferenceDraft" @revert="revert" @reload="reloadPreference">
      <UFormField orientation="horizontal" :label="t('settings.maintenance.timezone')" name="timezone">
        <UInput v-model="draft.timezone" class="w-full" data-testid="maintenance-timezone" :disabled="locked" dir="ltr" />
      </UFormField>
      <UFormField orientation="horizontal" :label="t('settings.maintenance.weekday')" name="weekday">
        <USelect v-model="draft.weekday" class="w-full" :items="weekdays" :disabled="locked" />
      </UFormField>
      <UFormField orientation="horizontal" :label="t('settings.maintenance.startTime')" name="startTime">
        <UInput v-model="startTime" class="w-full" type="time" dir="ltr" :disabled="locked" />
      </UFormField>
      <UFormField orientation="horizontal" :label="t('settings.maintenance.duration')" name="duration">
        <UInput v-model="draft.durationMinutes" class="w-full" data-testid="maintenance-duration" type="number" :min="1" :max="1440" :disabled="locked" />
      </UFormField>
    </SharedSettingsCard>
    <SharedRecordSection variant="list" :title="t('settings.maintenance.releases')">
      <p v-if="!snapshot.releases.items.length" class="p-(--liwan-card-pad) text-sm text-muted">{{ t('settings.maintenance.noReleases') }}</p>
      <article v-for="notice in snapshot.releases.items" :key="notice.id" class="space-y-2 p-(--liwan-card-pad)">
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="font-semibold" dir="ltr">{{ notice.releaseId }}</h3>
          <SharedStatusBadge tone="neutral" :label="t(`settings.maintenance.scope.${notice.scope}`)" />
          <SharedStatusBadge tone="neutral" :label="t(`settings.maintenance.releaseStatus.${notice.status}`)" />
          <SharedStatusBadge v-if="notice.urgency === 'security'" tone="warning" :label="t('settings.maintenance.security')" />
          <SharedStatusBadge v-if="deadlinePassed(notice)" tone="destructive" :label="t('settings.maintenance.deadlinePassed')" />
        </div>
        <p>{{ t('settings.maintenance.deadline', { date: formatDate(notice.deadlineAt), zone: timezone }) }}</p>
        <p>{{ t('settings.maintenance.estimate', { seconds: notice.estimatedSeconds }) }}</p>
        <p class="whitespace-pre-wrap">{{ notice.policy }}</p>
        <p v-if="notice.scope !== 'tenant'" class="text-muted">{{ t('settings.maintenance.sharedScope') }}</p>
      </article>
    </SharedRecordSection>
    <form v-if="available.length || editing" class="liwan-form" data-testid="maintenance-booking-form" @submit.prevent="saveBooking">
      <SharedFormSection panel :title="t(editing ? 'settings.maintenance.editBooking' : 'settings.maintenance.newBooking')">
        <UFormField :label="t('settings.maintenance.release')" name="release">
          <USelect v-model="releaseId" data-testid="maintenance-release" :items="releaseItems" :disabled="disabled || !!editing" @update:model-value="bookingDirty = true" />
        </UFormField>
        <UCheckbox v-if="!editing" v-model="usePreference" :label="t('settings.maintenance.usePreference')" :disabled="disabled || !snapshot.preference || state.dirty" @update:model-value="bookingDirty = true" />
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
        <UButton type="submit" :disabled="disabled || !releaseId || !editingAllowed || release?.status !== 'supported' || (usePreference && state.dirty)" :loading="busy">{{ t('settings.maintenance.confirmBooking') }}</UButton>
      </SharedFormActions>
    </form>
    <SharedRecordSection variant="list" :title="t('settings.maintenance.bookings')">
      <p v-if="!snapshot.bookings.items.length" class="p-(--liwan-card-pad) text-sm text-muted">{{ t('settings.maintenance.noBookings') }}</p>
      <article v-for="booking in snapshot.bookings.items" :key="booking.id" class="space-y-2 p-(--liwan-card-pad)">
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
