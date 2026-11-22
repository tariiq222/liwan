import { describe, expect, it } from 'vitest'
import { bookingParts, bookingTimestamp } from '../appointmentTime'

// The booking routes validate the start with `\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z` under fullmatch
// (odoo-addons/liwan_appointments/serializers/appointment_booking.py). `Date.prototype.toISOString` appends `.000`, so every
// request built with it was refused with 422 before it reached a booking.
const WIRE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

describe('bookingTimestamp', () => {
  it('writes the exact wire form the server accepts', () => {
    const value = bookingTimestamp('2026-11-22', '09:30')!
    expect(value).toMatch(WIRE)
    expect(value).not.toContain('.')
    // What the old code produced, and why it was refused.
    expect(new Date('2026-11-22T09:30:00').toISOString()).toMatch(/\.\d{3}Z$/)
    expect(new Date('2026-11-22T09:30:00').toISOString()).not.toMatch(WIRE)
  })

  it('reads the input in the browser zone and writes it in UTC', () => {
    const value = bookingTimestamp('2026-11-22', '09:30')!
    const parsed = new Date(value)
    expect(parsed.getHours()).toBe(9)
    expect(parsed.getMinutes()).toBe(30)
  })

  it('refuses a day or a time that is not one', () => {
    expect(bookingTimestamp('', '')).toBeNull()
    expect(bookingTimestamp('22-11-2026', '09:30')).toBeNull()
    expect(bookingTimestamp('2026-11-22', '9:30')).toBeNull()
    expect(bookingTimestamp('2026-13-45', '09:30')).toBeNull()
  })

  it('round-trips through bookingParts', () => {
    const value = bookingTimestamp('2026-03-05', '17:45')!
    expect(bookingParts(value)).toEqual({ day: '2026-03-05', time: '17:45' })
    expect(bookingParts(null)).toEqual({ day: '', time: '' })
    expect(bookingParts('not a date')).toEqual({ day: '', time: '' })
  })
})
