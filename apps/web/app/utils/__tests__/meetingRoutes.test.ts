import { describe, expect, it } from 'vitest'
import { meetingCreateRoute, meetingMinutesPdfPath } from '../meetingRoutes'

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

it('points the minutes PDF at the same-origin attachment route', () => {
  expect(meetingMinutesPdfPath(42)).toBe('/api/v1/meetings/42/minutes.pdf')
})
