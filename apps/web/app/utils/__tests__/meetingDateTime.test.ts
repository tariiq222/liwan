import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  buildMeetingSchedulePayload,
  fromUtcDateTimeInput,
  toUtcDateTime,
  validateMeetingSchedule,
} from '../meetingDateTime'

describe('meeting datetime wire conversion', () => {
  const originalTimezone = process.env.TZ
  beforeAll(() => { process.env.TZ = 'Asia/Riyadh' })
  afterAll(() => {
    if (originalTimezone === undefined) delete process.env.TZ
    else process.env.TZ = originalTimezone
  })

  it('serializes a datetime-local value as an ISO instant with the browser local offset', () => {
    expect(toUtcDateTime('2026-09-08T09:30')).toBe('2026-09-08T06:30:00.000Z')
    expect(toUtcDateTime('2026-09-07T23:30')).toBe('2026-09-07T20:30:00.000Z')
    expect(toUtcDateTime('2026-09-08T01:30')).toBe('2026-09-07T22:30:00.000Z')
  })

  it('converts a UTC response into the value expected by datetime-local', () => {
    const value = fromUtcDateTimeInput('2026-09-08T06:30:00.000Z')
    expect(value).toBe('2026-09-08T09:30')
    expect(fromUtcDateTimeInput('2026-09-08T00:30:00.000Z')).toBe('2026-09-08T03:30')
    expect(fromUtcDateTimeInput('2026-09-08T22:30:00.000Z')).toBe('2026-09-09T01:30')
  })

  it('keeps empty values optional', () => {
    expect(toUtcDateTime('')).toBeUndefined()
    expect(fromUtcDateTimeInput(null)).toBe('')
  })

  it('builds one calendar day with optional wall-clock times', () => {
    expect(buildMeetingSchedulePayload({ date: '2026-09-08', start: '09:30', end: '10:30' })).toEqual({
      meeting_date: '2026-09-08',
      start_datetime: '2026-09-08T09:30:00+03:00',
      end_datetime: '2026-09-08T10:30:00+03:00',
    })
    expect(buildMeetingSchedulePayload({ date: '2026-09-08', start: '', end: '' })).toEqual({
      meeting_date: '2026-09-08',
      start_datetime: undefined,
      end_datetime: undefined,
    })
  })

  it('preserves a legacy multi-day end when editing', () => {
    expect(buildMeetingSchedulePayload({
      date: '2026-09-08',
      start: '23:30',
      end: '01:30',
      endDate: '2026-09-09',
    })).toEqual({
      meeting_date: '2026-09-08',
      start_datetime: '2026-09-08T23:30:00+03:00',
      end_datetime: '2026-09-09T01:30:00+03:00',
    })
  })

  it('uses explicit nulls when an edit clears either clock', () => {
    expect(buildMeetingSchedulePayload({
      date: '2026-09-08', start: '', end: '', mode: 'patch',
    })).toEqual({ meeting_date: '2026-09-08', start_datetime: null, end_datetime: null })
  })

  it('requires a date and reports time order as field errors', () => {
    expect(validateMeetingSchedule({ date: '', start: '10:00', end: '09:00' })).toEqual({
      date: 'required',
      end: 'before_start',
    })
    expect(validateMeetingSchedule({ date: '2026-09-08', start: '10:00', end: '' })).toEqual({})
    expect(validateMeetingSchedule({ date: '2026-09-08', start: '10:00', end: '10:00', endDate: '2026-09-08' })).toEqual({ end: 'before_start' })
    expect(validateMeetingSchedule({ date: '2026-09-08', start: '10:00', end: '09:00', endDate: '2026-09-09' })).toEqual({})
    expect(validateMeetingSchedule({ date: '2026-09-08', start: '10:00', end: '09:00', endDate: '2026-09-07' })).toEqual({ endDate: 'before_date' })
  })
})
