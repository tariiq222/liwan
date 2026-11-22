import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  AppointmentBookingListSchema, AppointmentBookingSchema, AppointmentInvitationSchema, AppointmentTypeListSchema, AppointmentResourceListSchema,
  type AppointmentBookingCreate, type AppointmentBookingListQuery,
} from '@liwan/contracts'

/**
 * The staff booking API. Every route is `/api/v1/appointments/**` and every read is company-scoped by the server, so the
 * query keys carry the viewer's company: a company switch can never show the previous company's bookings.
 */
export const appointmentKeys = {
  bookings: (companyId: number | undefined, query: Partial<AppointmentBookingListQuery>) =>
    ['appointments', 'bookings', { companyId, ...query }] as const,
  booking: (companyId: number | undefined, id: number) => ['appointments', 'booking', { companyId, id }] as const,
  types: (companyId: number | undefined) => ['appointments', 'types', { companyId }] as const,
  resources: (companyId: number | undefined) => ['appointments', 'resources', { companyId }] as const,
}

/** The booking list. `from`/`to` are inclusive UTC dates on the start, which is what the calendar asks for. */
export function useAppointmentBookings(query: MaybeRefOrGetter<Partial<AppointmentBookingListQuery>>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { me } = useMe()
  return useQuery({
    queryKey: computed(() => appointmentKeys.bookings(me.value?.company?.id, toValue(query))),
    enabled: computed(() => toValue(enabled) && !!me.value),
    placeholderData: keepPreviousData,
    queryFn: () => $api('/api/v1/appointments/bookings', { query: toValue(query) as Record<string, unknown>, schema: AppointmentBookingListSchema }),
  })
}

/** One booking with its requester, notes and reasons; `is_modifiable` says whether the record may be edited. */
export function useAppointmentBooking(id: MaybeRefOrGetter<number | null>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { me } = useMe()
  const bookingId = computed(() => toValue(id))
  return useQuery({
    queryKey: computed(() => appointmentKeys.booking(me.value?.company?.id, bookingId.value ?? 0)),
    enabled: computed(() => toValue(enabled) && !!me.value && !!bookingId.value && bookingId.value > 0),
    queryFn: () => $api(`/api/v1/appointments/bookings/${bookingId.value}`, { schema: AppointmentBookingSchema }),
  })
}

export function useAppointmentTypes(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { me } = useMe()
  return useQuery({
    queryKey: computed(() => appointmentKeys.types(me.value?.company?.id)),
    enabled: computed(() => toValue(enabled) && !!me.value),
    queryFn: () => $api('/api/v1/appointments/types', { schema: AppointmentTypeListSchema }),
  })
}

export function useAppointmentResources(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { me } = useMe()
  return useQuery({
    queryKey: computed(() => appointmentKeys.resources(me.value?.company?.id)),
    enabled: computed(() => toValue(enabled) && !!me.value),
    queryFn: () => $api('/api/v1/appointments/resources', { schema: AppointmentResourceListSchema }),
  })
}

/**
 * Every write on a booking: create, schedule, confirm, cancel, edit, attendance and invitation. One mutation, because
 * they all answer with the booking and all invalidate the same two keys, so a change of state never leaves the list and
 * the record disagreeing.
 */
export type AppointmentBookingAction =
  | { action: 'create'; body: AppointmentBookingCreate }
  | { action: 'schedule'; id: number; body: { start: string } }
  | { action: 'confirm'; id: number }
  | { action: 'cancel'; id: number; body: { cancel_reason_id?: number | null; notes?: string | null } }
  | { action: 'update'; id: number; body: Record<string, unknown> }
  | { action: 'attendance'; id: number; body: { outcome: 'arrived' | 'in_service' | 'done' | 'no_show' } }
  | { action: 'invitation'; id: number }

export function useAppointmentBookingMutation() {
  const { $api } = useApi()
  const qc = useQueryClient()
  const { me } = useMe()
  return useMutation({
    mutationFn: async (command: AppointmentBookingAction) => {
      switch (command.action) {
        case 'create':
          return $api('/api/v1/appointments/bookings', { method: 'POST', body: command.body, schema: AppointmentBookingSchema })
        case 'schedule':
          return $api(`/api/v1/appointments/bookings/${command.id}/schedule`, { method: 'POST', body: command.body, schema: AppointmentBookingSchema })
        case 'confirm':
          return $api(`/api/v1/appointments/bookings/${command.id}/confirm`, { method: 'POST', body: {}, schema: AppointmentBookingSchema })
        case 'cancel':
          return $api(`/api/v1/appointments/bookings/${command.id}/cancel`, { method: 'POST', body: command.body, schema: AppointmentBookingSchema })
        case 'update':
          return $api(`/api/v1/appointments/bookings/${command.id}`, { method: 'PATCH', body: command.body, schema: AppointmentBookingSchema })
        case 'attendance':
          return $api(`/api/v1/appointments/bookings/${command.id}/attendance`, { method: 'POST', body: command.body, schema: AppointmentBookingSchema })
        case 'invitation':
          // The invitation route answers `{path}`, not the booking: reading it as a booking failed `.strict()` every time.
          return $api(`/api/v1/appointments/bookings/${command.id}/invitation`, { method: 'POST', body: {}, schema: AppointmentInvitationSchema })
      }
    },
    onSuccess: async () => {
      // Both keys, always: a state change moves a booking between the list's filters and rewrites its record.
      await qc.invalidateQueries({ queryKey: ['appointments', 'bookings'] })
      await qc.invalidateQueries({ queryKey: ['appointments', 'booking'] })
      void me.value?.company?.id
    },
  })
}
