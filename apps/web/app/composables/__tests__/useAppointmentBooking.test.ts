import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppointmentPublicBookingSchema, AppointmentSlotListSchema } from '@liwan/contracts'
import { bookingKeys, useGuestActions, useGuestBooking, useGuestSlots } from '../useAppointmentBooking'

const mocks = vi.hoisted(() => ({ api: vi.fn(), client: { setQueryData: vi.fn(), invalidateQueries: vi.fn() } }))
vi.mock('@tanstack/vue-query', async original => ({
  ...await original<object>(),
  useQuery: (options: unknown) => options,
  useMutation: (options: unknown) => options,
  useQueryClient: () => mocks.client,
}))

const link = { id: 42, token: 'tok-42' }

type QueryOptions = { queryKey: { value: unknown }; enabled?: { value: boolean }; queryFn: () => Promise<unknown>; retry: boolean; staleTime?: number }

function readBooking(params: Record<string, string>, query: Record<string, unknown>) {
  vi.stubGlobal('useRoute', () => ({ params, query }))
  vi.stubGlobal('useApi', () => ({ $api: mocks.api }))
  return useGuestBooking() as unknown as ReturnType<typeof useGuestBooking> & QueryOptions & { link: { value: unknown } }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('useGuestBooking', () => {
  it('reads the booking with its access token through the contract, with no session, no retry and no re-read on focus', async () => {
    const booking = readBooking({ id: '42' }, { access_token: 'tok-42' })
    expect(booking.link.value).toEqual(link)
    expect(booking.enabled!.value).toBe(true)
    expect(booking.retry).toBe(false)
    expect(booking.staleTime).toBe(Infinity)
    expect(booking.queryKey.value).toEqual(bookingKeys.record(link))
    mocks.api.mockResolvedValue({})
    await booking.queryFn().catch(() => undefined)
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/public/appointments/bookings/42', { query: { access_token: 'tok-42' }, schema: AppointmentPublicBookingSchema })
  })

  it('makes no request for an address without a usable id or token', () => {
    expect(readBooking({ id: '42' }, {}).enabled!.value).toBe(false)
    expect(readBooking({ id: 'x' }, { access_token: 'tok' }).enabled!.value).toBe(false)
    expect(readBooking({ id: '42' }, { access_token: ['a', 'b'] }).enabled!.value).toBe(false)
  })

  it('keeps a different cache entry per booking and token, and its slots under the booking\'s entry', () => {
    expect(bookingKeys.record(link)).not.toEqual(bookingKeys.record({ ...link, token: 'b' }))
    expect(bookingKeys.record(link)).not.toEqual(bookingKeys.record({ ...link, id: 2 }))
    expect(bookingKeys.slots(link, '2026-10-30', '2026-11-05').slice(0, 4)).toEqual(bookingKeys.record(link))
    expect(bookingKeys.slots(link, '2026-10-30', '2026-11-05')).not.toEqual(bookingKeys.slots(link, '2026-11-06', '2026-11-12'))
    expect(bookingKeys.slots(link)).toEqual([...bookingKeys.record(link), 'slots'])
  })
})

describe('useGuestSlots', () => {
  it('reads the free slots of a window with the token, through the contract', async () => {
    vi.stubGlobal('useApi', () => ({ $api: mocks.api }))
    const slots = useGuestSlots(ref(link), ref({ from: '2026-10-30', to: '2026-11-05' })) as unknown as QueryOptions
    expect(slots.retry).toBe(false)
    expect(slots.queryKey.value).toEqual(bookingKeys.slots(link, '2026-10-30', '2026-11-05'))
    mocks.api.mockResolvedValue({})
    await slots.queryFn().catch(() => undefined)
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/public/appointments/bookings/42/slots', {
      query: { access_token: 'tok-42', from: '2026-10-30', to: '2026-11-05' },
      schema: AppointmentSlotListSchema,
    })
  })
})

describe('useGuestActions', () => {
  type Mutation = { mutationFn: (input: unknown) => Promise<unknown>; onSuccess?: (booking: unknown, input: unknown) => void; onError?: (error: unknown, input: unknown) => void }

  function actions() {
    vi.stubGlobal('useApi', () => ({ $api: mocks.api }))
    return useGuestActions() as unknown as Record<'schedule' | 'confirm' | 'cancel', Mutation>
  }

  it('posts the token and the chosen start to the schedule route', async () => {
    mocks.api.mockResolvedValue({})
    await actions().schedule.mutationFn({ link, start: '2026-10-30T07:00:00Z' })
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/public/appointments/bookings/42/schedule', {
      method: 'POST',
      body: { access_token: 'tok-42', start: '2026-10-30T07:00:00Z' },
      schema: AppointmentPublicBookingSchema,
    })
  })

  it('posts only the token to the confirm and cancel routes', async () => {
    mocks.api.mockResolvedValue({})
    const { confirm, cancel } = actions()
    await confirm.mutationFn({ link })
    await cancel.mutationFn({ link })
    expect(mocks.api).toHaveBeenNthCalledWith(1, '/api/v1/public/appointments/bookings/42/confirm', { method: 'POST', body: { access_token: 'tok-42' }, schema: AppointmentPublicBookingSchema })
    expect(mocks.api).toHaveBeenNthCalledWith(2, '/api/v1/public/appointments/bookings/42/cancel', { method: 'POST', body: { access_token: 'tok-42' }, schema: AppointmentPublicBookingSchema })
  })

  it('puts each answer into the booking\'s cache entry instead of reading it again', () => {
    const answer = { id: 42, state: 'canceled' }
    for (const mutation of Object.values(actions())) mutation.onSuccess!(answer, { link })
    expect(mocks.client.setQueryData).toHaveBeenCalledTimes(3)
    expect(mocks.client.setQueryData).toHaveBeenCalledWith(bookingKeys.record(link), answer)
    // Only the schedule drops anything, and only the slots: the booking itself is never read again.
    expect(mocks.client.invalidateQueries).toHaveBeenCalledTimes(1)
    expect(mocks.client.invalidateQueries).toHaveBeenCalledWith({ queryKey: bookingKeys.slots(link) })
  })

  it('drops the cached slots when a schedule fails as taken, and on no other refusal', () => {
    const { schedule } = actions()
    schedule.onError!({ status: 422 }, { link })
    schedule.onError!({ status: 429 }, { link })
    expect(mocks.client.invalidateQueries).not.toHaveBeenCalled()
    schedule.onError!({ status: 409 }, { link })
    expect(mocks.client.invalidateQueries).toHaveBeenCalledWith({ queryKey: bookingKeys.slots(link) })
  })
})
