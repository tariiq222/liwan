import { computed, ref, toValue } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ bookings: vi.fn() }))

vi.mock('../useAppointments', () => ({ useAppointmentBookings: mocks.bookings }))

import { useAppointmentListKpis } from '../useAppointmentKpis'

const translate = (key: string) => key

function bookingQuery(total?: number) {
  return { data: ref(total === undefined ? undefined : { items: [], total }), isLoading: ref(false) }
}

/** The `enabled` argument of each `useAppointmentBookings` call, flattened to its value. */
const enabledFlags = () => mocks.bookings.mock.calls.map(call => toValue(call[1]))

beforeEach(() => {
  mocks.bookings.mockReset()
  mocks.bookings.mockImplementation(() => bookingQuery())
  vi.stubGlobal('useI18n', () => ({ t: translate }))
})

describe('the /appointments KPI tiles', () => {
  it('asks no KPI query while the strip is hidden or the page is not ready', () => {
    useAppointmentListKpis({ day: '2026-11-25' }, false)

    expect(mocks.bookings).toHaveBeenCalledTimes(4)
    expect(enabledFlags()).toEqual([false, false, false, false])
  })

  it('reads the day total from the list and leaves its own total query disabled', () => {
    mocks.bookings.mockImplementation(() => bookingQuery(4))
    const listTotal = ref<number | undefined>(12)
    const kpis = useAppointmentListKpis({ day: '2026-11-25' }, true, { wholeDay: computed(() => true), total: listTotal })

    expect(enabledFlags()).toEqual([false, true, true, true])
    expect(kpis.tiles.value.find(tile => tile.id === 'total')?.value).toBe(12)

    listTotal.value = 15
    expect(kpis.tiles.value.find(tile => tile.id === 'total')?.value).toBe(15)
  })

  it('asks its own total query once a state filter narrows the list', () => {
    mocks.bookings.mockImplementation(() => bookingQuery(4))
    const kpis = useAppointmentListKpis({ day: '2026-11-25' }, true, { wholeDay: computed(() => false), total: ref(3) })

    expect(mocks.bookings).toHaveBeenCalledTimes(4)
    expect(kpis.tiles.value.find(tile => tile.id === 'total')?.value).toBe(4)
  })
})
