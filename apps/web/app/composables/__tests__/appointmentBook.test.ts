import { describe, expect, it } from 'vitest'
import type { AppointmentPublicBooking } from '@liwan/contracts'
import { addDays, bookingLinkOf, canChange, formatDay, formatMoment, formatSlot, formatSlotTime, isInvalidBookingLink, localDay, refusalStatus, slotsByDay, windowDays } from '../appointmentBook'

describe('bookingLinkOf', () => {
  it('reads the booking and token of a well-formed address', () => {
    expect(bookingLinkOf('42', 'tok-42')).toEqual({ id: 42, token: 'tok-42' })
    expect(bookingLinkOf('7', 'aB_9-z')).toEqual({ id: 7, token: 'aB_9-z' })
  })

  it('refuses an id that is not a positive whole number', () => {
    for (const id of ['0', '-1', '01', 'abc', '4 2', '1.5', '', '1234567890123', undefined, 42, ['1']]) expect(bookingLinkOf(id, 'tok')).toBeNull()
  })

  it('refuses a missing, empty, repeated or oddly shaped token', () => {
    for (const token of [undefined, '', ['a', 'b'], 'a b', 'a/b', 'a?b', 'é', 'x'.repeat(129)]) expect(bookingLinkOf('1', token)).toBeNull()
  })
})

describe('refusals', () => {
  it('reads the status a failed call carries', () => {
    expect(refusalStatus({ status: 409 })).toBe(409)
    expect(refusalStatus(new Error('x'))).toBeNull()
    expect(refusalStatus(null)).toBeNull()
    expect(refusalStatus({ status: '404' })).toBeNull()
  })

  it('calls only a 404 an invalid link', () => {
    expect(isInvalidBookingLink({ status: 404 })).toBe(true)
    for (const status of [403, 409, 422, 429, 500]) expect(isInvalidBookingLink({ status })).toBe(false)
    expect(isInvalidBookingLink(undefined)).toBe(false)
  })
})

describe('canChange', () => {
  const booking = (extra: Partial<AppointmentPublicBooking>) => ({ state: 'pending', is_modifiable: true, ...extra }) as AppointmentPublicBooking

  it('lets the requester act on a live booking inside its change deadline', () => {
    for (const state of ['pending', 'scheduled', 'confirmed'] as const) expect(canChange(booking({ state }))).toBe(true)
  })

  it('offers nothing on a canceled booking or past the deadline', () => {
    expect(canChange(booking({ state: 'canceled' }))).toBe(false)
    expect(canChange(booking({ state: 'confirmed', is_modifiable: false }))).toBe(false)
  })
})

describe('days', () => {
  it('moves a calendar day across month and year ends', () => {
    expect(addDays('2026-10-29', 3)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('writes the local calendar day of a moment', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })

  it('lists a week of days and stops at the last bookable one', () => {
    expect(windowDays('2026-10-29', '2026-12-31')).toEqual(['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'])
    expect(windowDays('2026-10-29', '2026-10-31')).toEqual(['2026-10-29', '2026-10-30', '2026-10-31'])
    expect(windowDays('2026-10-31', '2026-10-31')).toEqual(['2026-10-31'])
  })

  it('groups slots by the requester\'s own day, keeping their order', () => {
    const first = new Date(2026, 9, 29, 10, 0)
    const second = new Date(2026, 9, 29, 12, 0)
    const next = new Date(2026, 9, 30, 9, 0)
    const slots = [first, second, next].map(moment => ({ start: moment.toISOString() }))
    const grouped = slotsByDay(slots)
    expect([...grouped.keys()]).toEqual(['2026-10-29', '2026-10-30'])
    expect(grouped.get('2026-10-29')).toEqual([slots[0], slots[1]])
  })
})

describe('formatting', () => {
  it('writes a calendar day with Latin digits whatever the time zone', () => {
    expect(formatDay('2026-10-31', 'ar')).toContain('31')
    expect(formatDay('2026-10-31', 'ar')).toContain('أكتوبر')
    expect(formatDay('2026-10-31', 'en', 'short')).toBe('Sat, Oct 31')
  })

  it('writes times of day and a slot range in the requester\'s zone with Latin digits', () => {
    const start = new Date(2026, 9, 29, 10, 30)
    const stop = new Date(2026, 9, 29, 11, 0)
    expect(formatSlotTime(start.toISOString(), 'en')).toBe('10:30 AM')
    expect(formatSlot({ start: start.toISOString(), stop: stop.toISOString() }, 'en')).toBe('10:30 AM – 11:00 AM')
    expect(formatSlotTime(start.toISOString(), 'ar')).toMatch(/^10:30\s/)
  })

  it('writes a moment as a long date with its time', () => {
    const text = formatMoment(new Date(2026, 9, 29, 14, 5).toISOString(), 'en')
    expect(text).toContain('October 29, 2026')
    expect(text).toContain('2:05 PM')
  })
})
