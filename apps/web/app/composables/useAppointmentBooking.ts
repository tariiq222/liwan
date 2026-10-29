import { computed, type Ref } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { AppointmentPublicBookingSchema, AppointmentSlotListSchema } from '@webvue/contracts'
import { bookingLinkOf, refusalStatus, type BookingLink } from './appointmentBook'

const bookingPath = (link: BookingLink) => `/api/v1/public/appointments/bookings/${link.id}`

export const bookingKeys = {
  record: (link: BookingLink | null) => ['appointments', 'book', link?.id ?? 0, link?.token ?? ''] as const,
  slots: (link: BookingLink | null, from?: string, to?: string) => [...bookingKeys.record(link), 'slots', ...(from && to ? [from, to] : [])] as const,
}

/**
 * The booking a booking-page address names, read with its access token and no session. A malformed address makes no
 * request (`link` is null). The answer is kept as it is until a call replaces it: a canceled booking's token is gone, so
 * re-reading it on focus would turn the canceled page into an invalid link.
 */
export function useGuestBooking() {
  const route = useRoute()
  const { $api } = useApi()
  const link = computed(() => bookingLinkOf(route.params.id, route.query.access_token))
  const query = useQuery({
    queryKey: computed(() => bookingKeys.record(link.value)),
    enabled: computed(() => link.value !== null),
    queryFn: () => $api(bookingPath(link.value!), { query: { access_token: link.value!.token }, schema: AppointmentPublicBookingSchema }),
    retry: false,
    staleTime: Infinity,
  })
  return { link, ...query }
}

/** The free slots from `from` to `to` (inclusive days) of the booking `link` names; no request while there is no range. */
export function useGuestSlots(link: Ref<BookingLink>, range: Ref<{ from: string; to: string } | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => bookingKeys.slots(link.value, range.value?.from, range.value?.to)),
    enabled: computed(() => range.value !== null),
    queryFn: () => $api(`${bookingPath(link.value)}/slots`, { query: { access_token: link.value.token, ...range.value! }, schema: AppointmentSlotListSchema }),
    retry: false,
  })
}

/**
 * The three things the requester can do. Each answers the booking as it now stands, which replaces the cached one.
 * A schedule, done or refused as taken (409), also drops the cached slots, which are then out of date.
 */
export function useGuestActions() {
  const { $api } = useApi()
  const client = useQueryClient()
  const post = (link: BookingLink, action: string, body: Record<string, string> = {}) =>
    $api(`${bookingPath(link)}/${action}`, { method: 'POST', body: { access_token: link.token, ...body }, schema: AppointmentPublicBookingSchema })
  const remember = (booking: unknown, { link }: { link: BookingLink }) => client.setQueryData(bookingKeys.record(link), booking)
  const dropSlots = (link: BookingLink) => client.invalidateQueries({ queryKey: bookingKeys.slots(link) })
  return {
    schedule: useMutation({
      mutationFn: ({ link, start }: { link: BookingLink; start: string }) => post(link, 'schedule', { start }),
      onSuccess: (booking, variables) => { remember(booking, variables); void dropSlots(variables.link) },
      onError: (error, { link }) => { if (refusalStatus(error) === 409) void dropSlots(link) },
    }),
    confirm: useMutation({ mutationFn: ({ link }: { link: BookingLink }) => post(link, 'confirm'), onSuccess: remember }),
    cancel: useMutation({ mutationFn: ({ link }: { link: BookingLink }) => post(link, 'cancel'), onSuccess: remember }),
  }
}
