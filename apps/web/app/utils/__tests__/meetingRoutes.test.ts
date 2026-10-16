import { describe, expect, it } from 'vitest'
import { meetingCreateRoute, meetingViewRoute } from '../meetingRoutes'

it('keeps list filters and chooses the filtered month when opening the calendar', () => {
  expect(meetingViewRoute({ q: 'budget', mine: '1', organizer_id: '7', date_from: '2026-09-10', offset: '25' }, 'calendar')).toEqual({
    path: '/meetings/calendar', query: { q: 'budget', mine: '1', organizer_id: '7', date_from: '2026-09-10', year: '2026', month: '9' },
  })
})

it('returns the shown month as a list range without overwriting an explicit range', () => {
  expect(meetingViewRoute({ year: '2026', month: '2', state: 'confirmed' }, 'list')).toEqual({
    path: '/meetings', query: { year: '2026', month: '2', state: 'confirmed', date_from: '2026-02-01', date_to: '2026-02-28' },
  })
  expect(meetingViewRoute({ year: '2026', month: '2', date_from: '2026-01-15', date_to: '2026-03-01' }, 'list').query).toMatchObject({ date_from: '2026-01-15', date_to: '2026-03-01' })
})

describe('meeting create routes', () => {
  it('carries project context into the create page and its return link', () => {
    expect(meetingCreateRoute('/meetings?project_id=42', 42)).toEqual({
      path: '/meetings/new',
      query: { project_id: '42', returnTo: '/meetings?project_id=42' },
    })
    expect(meetingCreateRoute('/meetings?project_id=42', '42', undefined)).toEqual({
      path: '/meetings/new',
      query: { project_id: '42', returnTo: '/meetings?project_id=42' },
    })
  })

  it('preserves series context when creating from a filtered list', () => {
    expect(meetingCreateRoute('/meetings?series_id=7', undefined, 7)).toEqual({
      path: '/meetings/new',
      query: { series_id: '7', returnTo: '/meetings?series_id=7' },
    })
  })
})
