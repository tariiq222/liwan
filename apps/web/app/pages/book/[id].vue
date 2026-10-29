<script setup lang="ts">
import BookHeader from '@/components/appointments/BookHeader.vue'
import BookSlotPicker from '@/components/appointments/BookSlotPicker.vue'
import { canChange, formatMoment, isInvalidBookingLink, refusalStatus } from '@/composables/appointmentBook'
import { useGuestActions, useGuestBooking } from '@/composables/useAppointmentBooking'

// The public page an invited requester opens from the booking link: no account, no session. The access token in the address
// is the only credential. They see the booking, pick a time to schedule or reschedule it, confirm it when the company asks
// them to, and cancel it. A canceled booking's token is gone, so the page keeps the answer of the cancel and never reads again.
definePageMeta({ layout: false, access: 'public' })

const { t, locale } = useI18n()
const hydrated = useHydrated()
const { link, data: booking, error, isLoading, isError, refetch } = useGuestBooking()
const actions = useGuestActions()

const invalidLink = computed(() => !link.value || isInvalidBookingLink(error.value))
const busy = computed(() => refusalStatus(error.value) === 429)
const changeable = computed(() => booking.value !== undefined && canChange(booking.value))
const scheduledAt = computed(() => (booking.value?.start ? formatMoment(booking.value.start, locale.value) : null))
const stateTone = { pending: 'warning', scheduled: 'info', confirmed: 'success', canceled: 'destructive' } as const

const confirmingCancel = ref(false)
const actionError = ref<string | null>(null)
const working = computed(() => actions.schedule.isPending.value || actions.confirm.isPending.value || actions.cancel.isPending.value)

// Why a call was refused, in the requester's words: the time was just taken (409), or the booking no longer allows it (422).
function failureText(cause: unknown): string {
  const status = refusalStatus(cause)
  if (status === 409) return t('appointments.book.errors.taken')
  if (status === 422) return t('appointments.book.errors.notAllowed')
  if (status === 429) return t('appointments.book.states.busy.title')
  return t('appointments.book.errors.failed')
}

async function run(call: () => Promise<unknown>) {
  if (!link.value || working.value) return
  actionError.value = null
  try {
    await call()
    confirmingCancel.value = false
  } catch (cause) {
    actionError.value = failureText(cause)
    // The booking may have changed or its link been withdrawn meanwhile: read it again so the page tells the truth.
    if (refusalStatus(cause) === 422 || isInvalidBookingLink(cause)) await refetch()
  }
}

const schedule = (start: string) => run(() => actions.schedule.mutateAsync({ link: link.value!, start }))
const confirm = () => run(() => actions.confirm.mutateAsync({ link: link.value! }))
const cancel = () => run(() => actions.cancel.mutateAsync({ link: link.value! }))
</script>

<template>
  <SharedStandalonePage>
    <template #header><BookHeader :title="t('appointments.book.title')" /></template>
    <UAlert v-if="invalidLink" role="alert" color="error" variant="subtle" icon="i-lucide-link-2-off" :title="t('appointments.book.states.invalidLink.title')" :description="t('appointments.book.states.invalidLink.body')" data-testid="book-invalid" />
    <div v-else-if="booking" class="grid gap-4">
      <div class="grid gap-2" data-testid="book-summary">
        <div class="flex items-center justify-between gap-2">
          <p class="min-w-0 break-words text-lg font-semibold text-highlighted" data-testid="book-type">{{ booking.type_name }}</p>
          <SharedStatusBadge size="sm" :tone="stateTone[booking.state]" :label="t(`appointments.book.state.${booking.state}`)" data-testid="book-state" />
        </div>
        <p class="text-sm text-muted">{{ booking.company_name }} · {{ t('appointments.duration', { count: booking.duration_minutes }) }}</p>
        <p v-if="booking.location" class="text-sm text-muted" data-testid="book-location">{{ booking.location }}</p>
        <ClientOnly>
          <p v-if="scheduledAt && booking.state !== 'canceled'" class="text-sm font-medium text-highlighted" data-testid="book-when">{{ scheduledAt }}</p>
        </ClientOnly>
        <p class="text-sm text-muted" data-testid="book-requester">{{ booking.requester.name }}</p>
      </div>
      <UAlert v-if="booking.state === 'canceled'" role="status" color="neutral" variant="subtle" icon="i-lucide-calendar-x" :title="t('appointments.book.states.canceled.title')" :description="t('appointments.book.states.canceled.body')" data-testid="book-canceled" />
      <UAlert v-else-if="!changeable" role="status" color="warning" variant="subtle" icon="i-lucide-lock" :title="t('appointments.book.states.locked.title')" :description="t('appointments.book.states.locked.body')" data-testid="book-locked" />
      <template v-else>
        <template v-if="booking.awaits_confirmation">
          <UAlert role="status" color="info" variant="subtle" icon="i-lucide-circle-help" :title="t('appointments.book.states.awaitsConfirmation.title')" :description="t('appointments.book.states.awaitsConfirmation.body')" data-testid="book-awaits" />
          <UButton type="button" size="lg" class="w-full justify-center" icon="i-lucide-check" :loading="actions.confirm.isPending.value" :disabled="!hydrated || working" :label="t('appointments.book.confirm')" data-testid="book-confirm" @click="confirm" />
        </template>
        <!-- Days and times are the requester's own, so they are drawn in the browser, never on the server. -->
        <ClientOnly>
          <BookSlotPicker
            v-if="link"
            :link="link"
            :first-date="booking.first_bookable_date"
            :last-date="booking.last_bookable_date"
            :submit-label="t(booking.start ? 'appointments.book.reschedule' : 'appointments.book.schedule')"
            :pending="actions.schedule.isPending.value"
            @submit="schedule"
          />
          <template #fallback><SharedLoadingSkeleton /></template>
        </ClientOnly>
        <UAlert v-if="actionError" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="actionError" data-testid="book-action-error" />
        <SharedInlineConfirm
          v-if="confirmingCancel"
          :title="t('appointments.book.cancelTitle')"
          :description="t('appointments.book.cancelBody')"
          :confirm-label="t('appointments.book.cancelConfirm')"
          :cancel-label="t('appointments.book.keep')"
          :pending="actions.cancel.isPending.value"
          @cancel="confirmingCancel = false"
          @confirm="cancel"
        />
        <UButton v-else type="button" color="error" variant="ghost" class="w-full justify-center" icon="i-lucide-calendar-x" :disabled="!hydrated || working" :label="t('appointments.book.cancel')" data-testid="book-cancel" @click="confirmingCancel = true" />
      </template>
    </div>
    <div v-else-if="isError" class="grid gap-4">
      <UAlert role="alert" color="warning" variant="subtle" icon="i-lucide-cloud-off" :title="t(busy ? 'appointments.book.states.busy.title' : 'appointments.book.states.unavailable.title')" :description="t(busy ? 'appointments.book.states.busy.body' : 'appointments.book.states.unavailable.body')" data-testid="book-unavailable" />
      <UButton type="button" color="neutral" variant="outline" class="w-full justify-center" icon="i-lucide-refresh-cw" :label="t('appointments.book.retry')" @click="() => refetch()" />
    </div>
    <SharedLoadingSkeleton v-else-if="isLoading" />
  </SharedStandalonePage>
</template>
