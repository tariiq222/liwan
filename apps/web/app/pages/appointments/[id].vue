<script setup lang="ts">
import { formatDateTime } from '@liwan/ui/app/utils/formatDate'
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import { useAppointmentBooking, useAppointmentBookingMutation } from '@/composables/appointments/useAppointments'

// One booking: who asked, when it is, and the actions the server allows. «المواعيد» is a staff application, so the page
// is the record a receptionist opens to confirm, reschedule, cancel or mark attendance; it never sends an invitation to
// someone who did not ask for one without the explicit button.
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const id = computed(() => {
  const value = Number(route.params.id)
  return Number.isSafeInteger(value) && value > 0 ? value : null
})
// The edit page is a child route: this page draws the record only on the record's own path, so the two do not stack.
const isRecord = computed(() => route.path.replace(/\/+$/, '') === `/appointments/${route.params.id}`)
const backTo = computed(() => safeReturnTo(route.query.returnTo, '/appointments', ['/appointments']))
const booking = useAppointmentBooking(id, computed(() => hydrated.value && can('appointments.bookings.read')))
const mutation = useAppointmentBookingMutation()

const record = computed(() => booking.data.value ?? null)
// The record's state is a page tag, so it stays beside the title instead of a second header.
const STATUS_TONE = { pending: 'info', scheduled: 'info', confirmed: 'success', canceled: 'neutral' } as const
const canManage = computed(() => can('appointments.bookings.manage'))
const pending = computed(() => mutation.isPending.value)
const failure = ref<string | null>(null)
const confirming = ref<'cancel' | 'confirm' | 'attendance' | 'invitation' | null>(null)

async function run(command: Parameters<typeof mutation.mutateAsync>[0]) {
  if (!hydrated.value || pending.value) return
  failure.value = null
  try {
    await mutation.mutateAsync(command)
    confirming.value = null
    await booking.refetch()
  } catch (cause) {
    failure.value = cause instanceof Error ? cause.message : t('errors.generic')
  }
}
/**
 * The attendance step the record may take next. The server names four outcomes and allows a fixed order; sending a bare
 * `attended: true` was refused with 422 on every booking, because it rejects any key but `outcome`.
 */
function nextAttendance(booking: { attendance: 'arrived' | 'in_service' | 'done' | 'no_show' | null }): 'arrived' | 'in_service' | 'done' | 'no_show' {
  switch (booking.attendance) {
    case null: return 'arrived'
    case 'arrived': return 'in_service'
    case 'in_service': return 'done'
    case 'no_show': return 'arrived'
    default: return 'done'
  }
}

const confirmCopy = computed(() => {
  switch (confirming.value) {
    case 'cancel': return { title: t('appointments.record.cancelTitle'), label: t('appointments.record.cancel'), color: 'error' as const }
    case 'confirm': return { title: t('appointments.record.confirmTitle'), label: t('appointments.record.confirm'), color: 'primary' as const }
    case 'attendance': return { title: t('appointments.record.attendanceTitle'), label: t('appointments.record.attendance'), color: 'primary' as const }
    case 'invitation': return { title: t('appointments.record.invitationTitle'), label: t('appointments.record.invitation'), color: 'primary' as const }
    default: return null
  }
})
function act() {
  const kind = confirming.value
  if (!kind || !record.value) return
  if (kind === 'cancel') return void run({ action: 'cancel', id: record.value.id, body: {} })
  if (kind === 'confirm') return void run({ action: 'confirm', id: record.value.id })
  if (kind === 'attendance') return void run({ action: 'attendance', id: record.value.id, body: { outcome: nextAttendance(record.value) } })
  return void run({ action: 'invitation', id: record.value.id })
}
</script>

<template>
  <NuxtPage v-if="!isRecord" />
  <SharedRecordPage v-else :title="record?.requester_name ?? t('appointments.title')" :back-to="backTo" :tags="record ? [{ label: t(`appointments.state.${record.state}`), tone: STATUS_TONE[record.state] }] : []">
    <SharedPageState
      :loading="booking.isLoading.value"
      :error="booking.error.value"
      :empty="!record && !booking.isLoading.value && !booking.error.value"
      :empty-text="t('appointments.record.notFound')"
      @retry="booking.refetch()"
    >
      <template v-if="record">
        <UAlert v-if="failure" role="alert" color="error" variant="subtle" :title="failure" data-testid="appointments-record-error" />
        <SharedRecordSection variant="panel" :title="t('appointments.record.details')">
          <template v-if="canManage && record.is_modifiable" #actions>
            <div class="flex flex-wrap gap-2">
              <UButton v-if="record.state === 'scheduled'" color="primary" variant="solid" :disabled="pending" :label="t('appointments.record.confirm')" data-testid="appointments-confirm" @click="confirming = 'confirm'" />
              <UButton v-if="record.state !== 'canceled'" color="neutral" variant="outline" :disabled="pending" :label="t('appointments.record.reschedule')" :to="{ path: `/appointments/${record.id}/edit`, query: { returnTo: route.fullPath } }" data-testid="appointments-reschedule" />
              <UButton v-if="record.state !== 'canceled'" color="error" variant="outline" :disabled="pending" :label="t('appointments.record.cancel')" data-testid="appointments-cancel" @click="confirming = 'cancel'" />
              <UButton v-if="record.state === 'confirmed'" color="neutral" variant="outline" :disabled="pending" :label="t('appointments.record.attendance')" data-testid="appointments-attendance" @click="confirming = 'attendance'" />
              <UButton color="neutral" variant="ghost" :disabled="pending" :label="t('appointments.record.invitation')" data-testid="appointments-invitation" @click="confirming = 'invitation'" />
            </div>
          </template>
          <!-- SharedPropertiesPanel takes rows through its default slot (SharedPropertyRow), not a `rows` prop: passing one
               left the panel empty, so the record showed no time, duration or notes at all. -->
          <SharedPropertiesPanel>
            <SharedPropertyRow :label="t('appointments.record.time')" :value="record.start ? formatDateTime(record.start) : t('appointments.list.unscheduled')" />
            <SharedPropertyRow :label="t('appointments.record.duration')" :value="t('appointments.duration', { count: record.duration_minutes })" />
            <SharedPropertyRow :label="t('appointments.record.notes')" :value="record.notes || '—'" />
            <SharedPropertyRow :label="t('appointments.record.visitReason')" :value="record.visit_reason?.name || '—'" />
            <SharedPropertyRow :label="t('appointments.record.cancelReason')" :value="record.cancel_reason?.name || '—'" />
          </SharedPropertiesPanel>
        </SharedRecordSection>
        <SharedInlineConfirm
          v-if="confirming && confirmCopy"
          :title="confirmCopy.title"
          :confirm-label="confirmCopy.label"
          :color="confirmCopy.color"
          :pending="pending"
          :disabled="!hydrated"
          data-testid="appointments-confirm-action"
          @confirm="act"
          @cancel="confirming = null"
        />
      </template>
    </SharedPageState>
  </SharedRecordPage>
</template>
