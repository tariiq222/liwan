import { describe, expect, it } from 'vitest'
import { meetingTabFromRoute, meetingTabQuery, meetingHistoryViewFromRoute } from '../meetingTabs'

describe('meeting tabs route state', () => {
  it('selects a valid query tab before any legacy hash', () => {
    expect(meetingTabFromRoute('minutes', '#meeting-agenda')).toBe('minutes')
  })

  it('maps legacy anchors, including the historical snapshot to minutes', () => {
    expect(meetingTabFromRoute(undefined, '#meeting-summary')).toBe('summary')
    expect(meetingTabFromRoute(undefined, '#meeting-agenda')).toBe('summary')
    expect(meetingTabFromRoute(undefined, '#meeting-minutes')).toBe('minutes')
    expect(meetingTabFromRoute(undefined, '#meeting-resolutions')).toBe('resolutions')
    expect(meetingTabFromRoute(undefined, '#meeting-attachments')).toBe('attachments')
    expect(meetingTabFromRoute(undefined, '#meeting-snapshot')).toBe('minutes')
  })

  it('opens existing agenda and versions links inside their consolidated sections', () => {
    expect(meetingTabFromRoute('agenda', '')).toBe('summary')
    expect(meetingTabFromRoute('versions', '')).toBe('history')
    expect(meetingHistoryViewFromRoute('versions', '', undefined)).toBe('versions')
    expect(meetingHistoryViewFromRoute('history', '', 'events')).toBe('events')
  })

  it('falls back safely and preserves unrelated query state', () => {
    expect(meetingTabFromRoute('unknown', '#not-a-meeting-anchor')).toBe('summary')
    expect(meetingTabQuery({ returnTo: '/meetings?q=review', state: 'confirmed' }, 'agenda')).toEqual({
      returnTo: '/meetings?q=review',
      state: 'confirmed',
      tab: 'agenda',
    })
  })
})
