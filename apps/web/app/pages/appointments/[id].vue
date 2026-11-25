<script setup lang="ts">
import type { PageHeaderTag } from '@liwan/ui/app/utils/pageHeaderTag'
import { formatDateTime } from '@liwan/ui/app/utils/formatDate'
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import { STATUS_COLOR } from '@liwan/ui/app/utils/statusTone'
import { ApiError } from '@/composables/useApi'
import { useAppointmentBooking, useAppointmentBookingMutation } from '@/composables/appointments/useAppointments'
import { appointmentHeroTone, appointmentStateTone } from '@/utils/appointmentKpis'

// One booking: who asked, when it is, and the actions the server allows. «المواعيد» is a staff application, so the page
// is the record a receptionist opens to confirm, reschedule, cancel or mark attendance; it never sends an invitation to
// someone who did not ask for one without the explicit button.
const route = useRoute()
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
const booking = useAppointmentBooking(id, computed(() => hydrated.value && isRecord.value && can('appointments.bookings.read')))
const mutation = useAppointmentBookingMutation()

const record = computed(() => booking.data.value ?? null)
const pageError = computed(() => booking.error.value ?? (id.value === null ? new ApiError(404, 'not_found', t('appointments.record.notFound')) : null))

const recentAppointments = useRecentRecords('appointment')
watch(() => [record.value?.id, record.value?.requester_name] as const, ([bookingId, name]) => {
  if (bookingId !== undefined && name && bookingId === id.value && !pageError.value) {
    recentAppointments.remember({ id: bookingId, name })
  }
}, { immediate: true })

const headerTags = computed<PageHeaderTag[]>(() => {
  if (!record.value) return []
  return [{
    label: t(`appointments.state.${record.value.state}`),
    tone: STATUS_COLOR[appointmentStateTone(record.value.state)],
  }]
})

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
function nextAttendance(item: { attendance: 'arrived' | 'in_service' | 'done' | 'no_show' | null }): 'arrived' | 'in_service' | 'done' | 'no_show' {
  switch (item.attendance) {
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

const attendanceTone = computed(() => {
  if (record.value?.attendance === 'no_show') return 'danger' as const
  if (record.value?.attendance === 'done') return 'success' as const
  return 'neutral' as const
})
</script>

<template>
  <NuxtPage v-if="!isRecord" />
  <SharedRecordPage
    v-else
    :title="record?.requester_name ?? t('appointments.title')"
    :back-to="backTo"
    :back-label="t('appointments.title')"
    :tags="headerTags"
    :loading="booking.isLoading.value"
    :error="pageError"
    :keep-content="Boolean(record)"
    @retry="booking.refetch()"
  >
    <template v-if="record && canManage && record.is_modifiable" #actions>
      <UButton
        v-if="record.state === 'scheduled'"
        color="primary"
        variant="solid"
        :disabled="!hydrated || pending"
        :label="t('appointments.record.confirm')"
        data-testid="appointments-confirm"
        @click="confirming = 'confirm'"
      />
      <UButton
        v-if="record.state !== 'canceled'"
        color="neutral"
        variant="outline"
        :disabled="!hydrated || pending"
        :label="t('appointments.record.reschedule')"
        :to="{ path: `/appointments/${record.id}/edit`, query: { returnTo: route.fullPath } }"
        data-testid="appointments-reschedule"
      />
      <UButton
        v-if="record.state === 'confirmed'"
        color="neutral"
        variant="outline"
        :disabled="!hydrated || pending"
        :label="t('appointments.record.attendance')"
        data-testid="appointments-attendance"
        @click="confirming = 'attendance'"
      />
      <UButton
        color="neutral"
        variant="ghost"
        :disabled="!hydrated || pending"
        :label="t('appointments.record.invitation')"
        data-testid="appointments-invitation"
        @click="confirming = 'invitation'"
      />
      <UButton
        v-if="record.state !== 'canceled'"
        color="error"
        variant="outline"
        :disabled="!hydrated || pending"
        :label="t('appointments.record.cancel')"
        data-testid="appointments-cancel"
        @click="confirming = 'cancel'"
      />
    </template>

    <template v-if="record" #summary>
      <SharedRecordHero
        :tone="appointmentHeroTone(record.state)"
        icon="i-lucide-calendar-clock"
        data-testid="appointments-hero"
      >
        <template #title>
          <span>{{ record.requester_name }}</span>
          <span dir="ltr" class="whitespace-nowrap text-base font-semibold text-muted tabular-nums">
            {{ record.start ? formatDateTime(record.start) : t('appointments.list.unscheduled') }}
          </span>
        </template>
        <template #meta>
          <span class="inline-flex items-center gap-1.5">
            <UIcon name="i-lucide-tag" class="size-4 shrink-0" aria-hidden="true" />
            <span>{{ record.type_name }}</span>
          </span>
          <span class="inline-flex items-center gap-1.5">
            <UIcon name="i-lucide-clock" class="size-4 shrink-0" aria-hidden="true" />
            <span>{{ t('appointments.duration', { count: record.duration_minutes }) }}</span>
          </span>
        </template>
        <SharedMetricTile
          v-if="record.attendance"
          density="compact"
          icon="i-lucide-user-check"
          :tone="attendanceTone"
          :label="t('appointments.record.attendanceStatus')"
          :value="t(`appointments.attendance.${record.attendance}`)"
        />
        <SharedMetricTile
          v-if="record.visit_reason"
          density="compact"
          icon="i-lucide-clipboard-list"
          tone="neutral"
          :label="t('appointments.record.visitReason')"
          :value="record.visit_reason.name"
        />
      </SharedRecordHero>
    </template>

    <template v-if="record">
      <UAlert v-if="failure" role="alert" color="error" variant="subtle" :title="failure" data-testid="appointments-record-error" />
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
      <SharedRecordSection variant="panel" :title="t('appointments.record.notes')" data-testid="appointments-notes">
        <p v-if="record.notes" class="whitespace-pre-line text-sm text-default">{{ record.notes }}</p>
        <p v-else class="text-sm text-muted">{{ t('appointments.record.noNotes') }}</p>
      </SharedRecordSection>
    </template>
    <SharedEmptyState v-else-if="!booking.isLoading.value && !pageError" icon="i-lucide-calendar-x" :title="t('appointments.record.notFound')" />

    <template v-if="record" #aside>
      <SharedPropertiesPanel :title="t('appointments.record.details')" data-testid="appointments-properties">
        <SharedPropertyRow v-if="record.reference" :label="t('app.recordNumber')">
          <SharedRecordNumber :value="record.reference" />
        </SharedPropertyRow>
        <SharedPropertyRow v-if="record.requester.phone" :label="t('appointments.form.phone')">
          <bdi dir="ltr">{{ record.requester.phone }}</bdi>
        </SharedPropertyRow>
        <SharedPropertyRow v-if="record.requester.email" :label="t('appointments.settings.requester.fields.email_field')">
          <bdi dir="ltr">{{ record.requester.email }}</bdi>
        </SharedPropertyRow>
        <SharedPropertyRow v-if="record.national_id" :label="t('appointments.settings.requester.fields.national_id_field')">
          <bdi dir="ltr">{{ record.national_id }}</bdi>
        </SharedPropertyRow>
        <SharedPropertyRow :label="t('appointments.record.cancelReason')" :value="record.cancel_reason?.name || '—'" />
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
</template>
