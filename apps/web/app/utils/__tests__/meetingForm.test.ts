import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  buildRecurrencePreview,
  getMeetingFormErrors,
  isSafeMeetingUrl,
  normalizeRecurrenceEnd,
} from '../meetingForm'

describe('meeting series termination', () => {
  const originalTimezone = process.env.TZ
  beforeAll(() => { process.env.TZ = 'Asia/Riyadh' })
  afterAll(() => {
    if (originalTimezone === undefined) delete process.env.TZ
    else process.env.TZ = originalTimezone
  })

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

  it('requires a recurrence end and rejects unsafe links', () => {
    expect(getMeetingFormErrors({
      name: '', date: '2026-09-08', start: '09:00', end: '10:00',
      meetingUrl: 'javascript:alert(1)', recurrence: 'weekly', untilMode: 'count', untilCount: '', untilDate: '',
    })).toEqual({ name: 'required', meetingUrl: 'unsafe_url', untilCount: 'required' })
    expect(isSafeMeetingUrl('https://meet.example.test/room')).toBe(true)
    expect(isSafeMeetingUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeMeetingUrl('')).toBe(true)
  })

  it('keeps an explicitly empty required date invalid', () => {
    expect(getMeetingFormErrors({
      name: 'Missing date', date: '', start: '', end: '', meetingUrl: '',
    })).toEqual({ date: 'required' })
  })

  it('previews weekly and monthly schedules with backend-compatible bounds', () => {
    expect(buildRecurrencePreview({
      recurrence: 'weekly', start: '2026-09-08T09:00', end: '2026-09-08T10:00', untilCount: 3,
    })).toEqual([
      { start: '2026-09-08T09:00', end: '2026-09-08T10:00' },
      { start: '2026-09-15T09:00', end: '2026-09-15T10:00' },
      { start: '2026-09-22T09:00', end: '2026-09-22T10:00' },
    ])
    expect(buildRecurrencePreview({
      recurrence: 'monthly', start: '2026-01-31T09:00', end: '2026-01-31T10:00', untilCount: 3,
    }).map(item => item.start)).toEqual([
      '2026-01-31T09:00', '2026-03-31T09:00', '2026-05-31T09:00',
    ])
    expect(buildRecurrencePreview({
      recurrence: 'weekly', start: '2026-09-08T23:30', end: '2026-09-09T00:30', untilCount: 2,
    })).toEqual([
      { start: '2026-09-08T23:30', end: '2026-09-09T00:30' },
      { start: '2026-09-15T23:30', end: '2026-09-16T00:30' },
    ])
    expect(buildRecurrencePreview({
      recurrence: 'weekly', start: '2026-09-08T00:30', end: '2026-09-08T01:30', untilCount: 1,
    })).toEqual([{ start: '2026-09-08T00:30', end: '2026-09-08T01:30' }])
    expect(buildRecurrencePreview({
      recurrence: 'monthly', start: '2026-01-01T00:30', end: '2026-01-01T01:30', untilCount: 3,
    }).map(item => item.start)).toEqual([
      '2026-01-01T00:30', '2026-02-01T00:30', '2026-04-01T00:30',
    ])
  })

  it('rejects a date termination that would exceed the backend occurrence cap', () => {
    expect(getMeetingFormErrors({
      name: 'Long series', start: '2026-09-08T09:00', end: '2026-09-08T10:00', meetingUrl: '',
      recurrence: 'weekly', untilMode: 'date', untilCount: '', untilDate: '2028-01-01',
    }).untilDate).toBe('invalid')
    expect(getMeetingFormErrors({
      name: 'Midnight series', start: '2026-09-08T00:30', end: '2026-09-08T01:30', meetingUrl: '',
      recurrence: 'weekly', untilMode: 'date', untilCount: '', untilDate: '2026-09-07',
    }).untilDate).toBeUndefined()
  })

  it('rejects malformed datetime-local calendar values', () => {
    expect(getMeetingFormErrors({
      name: 'Invalid schedule', start: '2026-02-30T09:00', end: '2026-02-30T10:00', meetingUrl: '',
      recurrence: 'weekly', untilMode: 'count', untilCount: '2', untilDate: '',
    }).start).toBe('invalid')
  })
})
