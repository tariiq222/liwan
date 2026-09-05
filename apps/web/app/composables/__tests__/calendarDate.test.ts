import { describe, expect, it } from 'vitest'
import { fromCalendarDate, toCalendarDate } from '../calendarDate'

describe('calendarDate', () => {
  it('round-trips YYYY-MM-DD without timezone drift', () => {
    const d = toCalendarDate('2030-02-01')!
    expect([d.year, d.month, d.day]).toEqual([2030, 2, 1])
    expect(fromCalendarDate(d)).toBe('2030-02-01')
    expect(toCalendarDate(null)).toBeUndefined()
    expect(fromCalendarDate(undefined)).toBeNull()
  })
})
