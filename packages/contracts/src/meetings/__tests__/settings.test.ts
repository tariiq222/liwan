import { describe, expect, it } from 'vitest'
import { MeetingSeriesPatchSchema } from '../settings'

describe('meeting series settings patch contract', () => {
  it('accepts only editable defaults and nullable secretary', () => {
    const body = MeetingSeriesPatchSchema.parse({
      name: 'Weekly operations',
      location: 'Room 4',
      meeting_url: 'https://meet.example.test/ops',
      secretary_id: null,
      attendee_ids: [11, 12],
    })

    expect(body).toEqual({
      name: 'Weekly operations',
      location: 'Room 4',
      meeting_url: 'https://meet.example.test/ops',
      secretary_id: null,
      attendee_ids: [11, 12],
    })
  })

  it('rejects recurrence and other non-settings keys instead of silently accepting them', () => {
    expect(() => MeetingSeriesPatchSchema.parse({ recurrence: 'weekly' })).toThrow()
    expect(() => MeetingSeriesPatchSchema.parse({ organizer_id: 11 })).toThrow()
    expect(() => MeetingSeriesPatchSchema.parse({ company_id: 2 })).toThrow()
    expect(() => MeetingSeriesPatchSchema.parse({ project_id: 7 })).toThrow()
  })

  it('rejects invalid names, urls, and user references', () => {
    expect(() => MeetingSeriesPatchSchema.parse({ name: '   ' })).toThrow()
    expect(() => MeetingSeriesPatchSchema.parse({ meeting_url: 'not-a-url' })).toThrow()
    expect(() => MeetingSeriesPatchSchema.parse({ meeting_url: 'ftp://files.example.test/minutes' })).toThrow()
    expect(() => MeetingSeriesPatchSchema.parse({ secretary_id: 0 })).toThrow()
    expect(() => MeetingSeriesPatchSchema.parse({ attendee_ids: [1, 0] })).toThrow()
  })
})
