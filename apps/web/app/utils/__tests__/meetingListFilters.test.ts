import { describe, expect, it } from 'vitest'
import { clearMeetingListFilters, meetingDateRange, parseMeetingListFilters, patchMeetingListQuery } from '../meetingListFilters'

describe('meeting list route filters', () => {
  it('parses only positive ids and exposes malformed or reversed dates', () => {
    expect(parseMeetingListFilters({ project_id: '0', organizer_id: '17', date_from: '2026-02-31', date_to: '2026-02-01' })).toMatchObject({ organizerId: 17, dateFrom: '2026-02-31', dateTo: '2026-02-01' })
    expect(meetingDateRange('2026-02-31', '2026-03-01').invalid).toBe(true)
    expect(meetingDateRange('2026-03-02', '2026-03-01').reversed).toBe(true)
  })

  it('preserves unrelated query values and resets offset when filters change', () => {
    expect(patchMeetingListQuery({ returnTo: '/meetings', q: 'old', offset: '50' }, { q: 'new' })).toEqual({ returnTo: '/meetings', q: 'new', offset: undefined })
  })

  it('clears known filters without removing unrelated query values', () => {
    expect(clearMeetingListFilters({ returnTo: '/meetings', q: 'old', mine: '1', project_id: '4', offset: '25' })).toMatchObject({ returnTo: '/meetings', q: undefined, mine: undefined, project_id: undefined, offset: undefined })
  })
})
