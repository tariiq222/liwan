import { describe, expect, it } from 'vitest'
import { addWeeks, isIsoDate, weekStartOf } from '../shiftWeek'

describe('shiftWeek', () => {
  it('starts the week on Sunday', () => {
    expect(weekStartOf('2026-11-01')).toBe('2026-11-01')
    expect(weekStartOf('2026-11-04')).toBe('2026-11-01')
    expect(weekStartOf('2026-11-07')).toBe('2026-11-01')
    expect(weekStartOf('2026-11-08')).toBe('2026-11-08')
  })

  it('moves whole weeks across a month and year end', () => {
    expect(addWeeks('2026-11-01', 1)).toBe('2026-11-08')
    expect(addWeeks('2026-12-27', 1)).toBe('2027-01-03')
    expect(addWeeks('2026-01-04', -1)).toBe('2025-12-28')
  })

  it('accepts only real ISO dates', () => {
    expect(isIsoDate('2026-11-01')).toBe(true)
    expect(isIsoDate('2026-13-01')).toBe(false)
    expect(isIsoDate('tomorrow')).toBe(false)
    expect(isIsoDate(undefined)).toBe(false)
  })
})
