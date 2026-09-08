import { describe, expect, it } from 'vitest'
import { normalizeRecurrenceEnd } from '../meetingForm'

describe('meeting series termination', () => {
  it('sends one termination mode and clears the stale field', () => {
    expect(normalizeRecurrenceEnd({ mode: 'count', count: '4', date: '2026-12-31' })).toEqual({
      until_count: 4,
      until_date: undefined,
    })
    expect(normalizeRecurrenceEnd({ mode: 'date', count: '4', date: '2026-12-31' })).toEqual({
      until_count: undefined,
      until_date: '2026-12-31',
    })
  })

  it('does not send invalid counts or dates', () => {
    expect(normalizeRecurrenceEnd({ mode: 'count', count: '0', date: '' })).toEqual({
      until_count: undefined,
      until_date: undefined,
    })
    expect(normalizeRecurrenceEnd({ mode: 'date', count: '4', date: 'not-a-date' })).toEqual({
      until_count: undefined,
      until_date: undefined,
    })
  })
})
