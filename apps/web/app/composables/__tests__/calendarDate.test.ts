import { describe, expect, it } from 'vitest'
import { formatNasqDateTime, formatNasqTime, toCalendarDate } from '../calendarDate'

describe('calendarDate', () => {
  it('round-trips YYYY-MM-DD without timezone drift', () => {
    const d = toCalendarDate('2030-02-01')!
    expect([d.year, d.month, d.day]).toEqual([2030, 2, 1])
    expect(toCalendarDate(null)).toBeUndefined()
  })

  it('formats instants with a shared Gregorian helper', () => {
    expect(formatNasqDateTime(null, 'en')).toBe('—')
    expect(formatNasqTime('', 'en')).toBe('—')
    expect(formatNasqDateTime('not-a-date', 'en')).toBe('not-a-date')
    expect(formatNasqDateTime(new Date('2026-03-15T12:00:00Z'), 'en')).toMatch(/Mar/)
  })
})
