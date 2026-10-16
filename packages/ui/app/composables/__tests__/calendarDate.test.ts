import { describe, expect, it } from 'vitest'
import { formatCalendarDate, formatWebVueDateTime, formatWebVueTime, toCalendarDate } from '../calendarDate'

describe('calendarDate', () => {
  it('round-trips YYYY-MM-DD without timezone drift', () => {
    const d = toCalendarDate('2030-02-01')!
    expect([d.year, d.month, d.day]).toEqual([2030, 2, 1])
    expect(toCalendarDate(null)).toBeUndefined()
  })

  it('formats calendar days as dd/MM/yyyy in every locale', () => {
    expect(formatCalendarDate('2035-12-31', 'ar')).toBe('\u206631/12/2035\u2069')
    expect(formatCalendarDate('2035-12-31', 'en')).toBe('\u206631/12/2035\u2069')
    expect(formatCalendarDate(null, 'ar')).toBe('')
  })

  it('formats instants with a shared Gregorian helper', () => {
    expect(formatWebVueDateTime(null, 'en')).toBe('—')
    expect(formatWebVueTime('', 'en')).toBe('—')
    expect(formatWebVueDateTime('not-a-date', 'en')).toBe('not-a-date')
    expect(formatWebVueDateTime(new Date('2026-03-15T12:00:00Z'), 'en')).toMatch(/^\u2066\d{2}\/03\/2026 \d{2}:\d{2}\u2069$/)
  })
})
