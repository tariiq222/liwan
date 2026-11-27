<script setup lang="ts">
import { computed, ref } from 'vue'
import { ApiError } from '@/composables/useApi'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'
import {
  MaintenancePreferencePatchSchema,
  type MaintenanceBooking, type MaintenancePreference, type MaintenancePreferencePatch, type MaintenanceSnapshot,
} from '@liwan/contracts'

const props = defineProps<{
  snapshot: MaintenanceSnapshot
  pending?: boolean
  reload: () => Promise<MaintenanceSnapshot>
  savePreference: (value: MaintenancePreferencePatch) => Promise<MaintenancePreference>
  updateBooking: (id: number, value: { status: 'cancelled'; revision: number }) => Promise<unknown>
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
const cancelTarget = ref<MaintenanceBooking | null>(null)
const error = ref('')
const busy = ref(false)
const disabled = computed(() => !hydrated.value || busy.value || props.pending)
const locked = computed(() => disabled.value || state.value.saving || state.value.reloading)
const deadlinePassed = (item: { deadlineAt: string }) => new Date(item.deadlineAt).getTime() <= Date.now()
const available = computed(() => props.snapshot.releases.items.filter(item => item.scope === 'tenant' && item.status === 'supported' && !deadlinePassed(item) && !props.snapshot.bookings.items.some(booking => booking.releaseId === item.id && booking.status !== 'cancelled')))
const weekdays = computed(() => Array.from({ length: 7 }, (_, value) => ({ value, label: t(`settings.maintenance.weekdays.${value}`) })))
function message(cause: unknown) {
  return cause instanceof Error ? cause.message : t('errors.generic')
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
</script>

<template>
  <div class="grid gap-(--liwan-gap-card)">
    <UAlert v-if="error" data-testid="maintenance-bookings-error" color="error" :title="error" />
    <SharedSettingsCard id="maintenance" v-bind="state" data-testid="maintenance-preference-form" :title="t('settings.maintenance.preference')" :description="t('settings.maintenance.preferenceHint')" :can-edit="true" @save="savePreferenceDraft" @revert="revert" @reload="reloadPreference">
      <div class="liwan-auto-grid liwan-field-grid liwan-setting-fields">
        <UFormField :label="t('settings.maintenance.timezone')" name="timezone">
          <UInput v-model="draft.timezone" class="w-full" data-testid="maintenance-timezone" :disabled="locked" dir="ltr" />
        </UFormField>
        <UFormField :label="t('settings.maintenance.weekday')" name="weekday">
          <USelect v-model="draft.weekday" class="w-full" :items="weekdays" :disabled="locked" />
        </UFormField>
        <UFormField :label="t('settings.maintenance.startTime')" name="startTime">
          <UInput v-model="startTime" class="w-full" type="time" dir="ltr" :disabled="locked" />
        </UFormField>
        <UFormField :label="t('settings.maintenance.duration')" name="duration">
          <UInput v-model="draft.durationMinutes" class="w-full" data-testid="maintenance-duration" type="number" :min="1" :max="1440" :disabled="locked" />
        </UFormField>
      </div>
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
    <SharedRecordSection variant="list" :title="t('settings.maintenance.bookings')">
      <template #actions>
        <UButton v-if="available.length" to="/settings/system/maintenance/new" icon="i-lucide-plus" data-testid="maintenance-booking-add">{{ t('settings.maintenance.newBooking') }}</UButton>
      </template>
      <p v-if="!snapshot.bookings.items.length" class="p-(--liwan-card-pad) text-sm text-muted">{{ t('settings.maintenance.noBookings') }}</p>
      <article v-for="booking in snapshot.bookings.items" :key="booking.id" class="space-y-2 p-(--liwan-card-pad)">
        <h3 class="font-semibold">{{ snapshot.releases.items.find(item => item.id === booking.releaseId)?.releaseId ?? booking.releaseId }}</h3>
        <p>{{ formatDate(booking.scheduledAt, booking.timezone) }} · {{ booking.timezone }}</p>
        <p>{{ t('settings.maintenance.windowMinutes', { minutes: booking.durationMinutes }) }}</p>
        <SharedStatusBadge tone="neutral" :label="t(`settings.maintenance.status.${booking.status}`)" />
        <div v-if="booking.status === 'scheduled'" class="flex gap-2">
          <UButton :to="`/settings/system/maintenance/${booking.id}/edit`" color="neutral" variant="outline" :data-testid="`maintenance-edit-${booking.id}`">{{ t('settings.maintenance.editBooking') }}</UButton>
          <UButton type="button" color="error" variant="outline" :disabled="disabled" :data-testid="`maintenance-cancel-${booking.id}`" @click="cancelTarget = { ...booking }">{{ t('settings.maintenance.cancelBooking') }}</UButton>
        </div>
        <SharedInlineConfirm v-if="booking.status === 'scheduled' && cancelTarget?.id === booking.id" :title="t('settings.maintenance.confirmCancel')" :confirm-label="t('settings.maintenance.cancelBooking')" :pending="busy" :disabled="disabled" @confirm="cancelBooking" @cancel="cancelTarget = null" />
      </article>
    </SharedRecordSection>
  </div>
</template>
