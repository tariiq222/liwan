import { describe, expect, it } from 'vitest'
import { formatCalendarDate, formatLiwanDateTime, formatLiwanTime, toCalendarDate } from '../calendarDate'

describe('calendarDate', () => {
  it('round-trips YYYY-MM-DD without timezone drift', () => {
    const d = toCalendarDate('2030-02-01')!
    expect([d.year, d.month, d.day]).toEqual([2030, 2, 1])
    expect(toCalendarDate(null)).toBeUndefined()
  })

  it('formats calendar days as dd/MM/yyyy in every locale', () => {
    expect(formatCalendarDate('2035-12-31')).toBe('\u206631/12/2035\u2069')
    expect(formatCalendarDate('2035-12-31')).toBe('\u206631/12/2035\u2069')
    expect(formatCalendarDate(null)).toBe('')
  })

  it('formats instants with a shared Gregorian helper', () => {
    expect(formatLiwanDateTime(null)).toBe('—')
    expect(formatLiwanTime('')).toBe('—')
    expect(formatLiwanDateTime('not-a-date')).toBe('not-a-date')
    expect(formatLiwanDateTime(new Date('2026-03-15T12:00:00Z'))).toMatch(/^\u2066\d{2}\/03\/2026 \d{2}:\d{2}\u2069$/)
  })
})
