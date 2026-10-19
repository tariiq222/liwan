import { describe, expect, it } from 'vitest'
import { MeetingOccurrenceCreateSchema } from '@webvue/contracts'
import { buildOccurrencePayload, occurrenceFormErrors } from '../meetingOccurrence'

const empty = { name: '', date: '', start: '', end: '' }

describe('occurrence form', () => {
  it('accepts an empty form: the series defaults decide everything', () => {
    expect(occurrenceFormErrors(empty)).toEqual({})
    expect(buildOccurrencePayload(empty)).toEqual({})
  })

  it('sends only the trimmed name when no date is given', () => {
    expect(buildOccurrencePayload({ ...empty, name: '  Extra  ' })).toEqual({ name: 'Extra' })
  })

  it('asks for the start and the end together once a date is set', () => {
    expect(occurrenceFormErrors({ ...empty, date: '2026-10-20' })).toEqual({ start: 'required', end: 'required' })
    expect(occurrenceFormErrors({ ...empty, start: '09:00' })).toMatchObject({ date: 'required', end: 'required' })
    expect(occurrenceFormErrors({ ...empty, date: '2026-10-20', start: '10:00', end: '09:00' })).toEqual({ end: 'before_start' })
  })

  it('builds a wire payload the contract accepts', () => {
    const payload = buildOccurrencePayload({ name: 'Extra', date: '2026-10-20', start: '09:00', end: '10:30' })
    expect(payload).toMatchObject({ name: 'Extra' })
    expect(MeetingOccurrenceCreateSchema.parse(payload)).toEqual(payload)
  })

  it('rejects a lone start or an inverted range in the contract', () => {
    expect(MeetingOccurrenceCreateSchema.safeParse({ start_datetime: '2026-10-20T09:00:00+03:00' }).success).toBe(false)
    expect(MeetingOccurrenceCreateSchema.safeParse({ start_datetime: '2026-10-20T10:00:00+03:00', end_datetime: '2026-10-20T09:00:00+03:00' }).success).toBe(false)
  })
})
