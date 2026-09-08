import { describe, expect, it } from 'vitest'
import { meetingCreateRoute } from '../meetingRoutes'

describe('meeting create routes', () => {
  it('carries project context into the create page and its return link', () => {
    expect(meetingCreateRoute('/meetings?project_id=42', 42)).toEqual({
      path: '/meetings/new',
      query: { project_id: '42', returnTo: '/meetings?project_id=42' },
    })
  })
})
