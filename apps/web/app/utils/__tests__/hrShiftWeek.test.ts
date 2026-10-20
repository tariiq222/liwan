import { describe, expect, it } from 'vitest'
import { SHIFT_WEEK_ORDER, sortShiftLines } from '../hrShiftWeek'

describe('hr shift week', () => {
  it('starts on Sunday and keeps every Odoo day value once', () => {
    expect(SHIFT_WEEK_ORDER[0]).toBe('6')
    expect([...SHIFT_WEEK_ORDER].sort()).toEqual(['0', '1', '2', '3', '4', '5', '6'])
  })

  it('sorts lines Sunday first and keeps the given order within a day', () => {
    const lines = [
      { dayofweek: '0' as const, id: 'mon-am' },
      { dayofweek: '6' as const, id: 'sun-pm' },
      { dayofweek: '5' as const, id: 'sat' },
      { dayofweek: '6' as const, id: 'sun-am' },
    ]
    expect(sortShiftLines(lines).map(line => line.id)).toEqual(['sun-pm', 'sun-am', 'mon-am', 'sat'])
    expect(lines[0]?.id).toBe('mon-am')
  })
})
