import { describe, expect, it } from 'vitest'
import {
  calendarCoverage,
  filterMeetingResolutions,
  resolutionActions,
  selectNextMeeting,
} from '../meetingWorkspace'

describe('meeting workspace projections', () => {
  it('chooses the next live meeting by its actual start time', () => {
    const now = new Date('2026-09-09T10:00:00.000Z')
    const meetings = [
      { id: 1, name: 'Later', meeting_date: '2026-09-09', start_datetime: '2026-09-09T12:00:00.000Z', state: 'confirmed' },
      { id: 2, name: 'Cancelled soon', meeting_date: '2026-09-09', start_datetime: '2026-09-09T10:30:00.000Z', state: 'cancelled' },
      { id: 3, name: 'Earlier', meeting_date: '2026-09-09', start_datetime: '2026-09-09T10:15:00.000Z', state: 'confirmed' },
      { id: 4, name: 'Done tomorrow', meeting_date: '2026-09-10', start_datetime: '2026-09-10T09:00:00.000Z', state: 'done' },
    ]

    expect(selectNextMeeting(meetings, now)?.id).toBe(3)
  })

  it('filters recommendations by status and searchable text', () => {
    const resolutions = [
      { id: 1, name: 'Confirm budget', state: 'open', responsible: { name: 'Amina' } },
      { id: 2, name: 'Publish minutes', state: 'open', execution_state: 'done', responsible: { name: 'Omar' } },
      { id: 3, name: 'Budget follow-up', state: 'in_progress', responsible: { name: 'Omar' } },
    ]

    expect(filterMeetingResolutions(resolutions, { q: 'budget', state: 'in_progress' }).map(item => item.id)).toEqual([3])
    expect(filterMeetingResolutions(resolutions, { q: 'omar' }).map(item => item.id)).toEqual([2, 3])
    expect(filterMeetingResolutions(resolutions, { state: 'done' }).map(item => item.id)).toEqual([2])
  })

  it('uses server action permissions and keeps a conservative fallback for old payloads', () => {
    expect(resolutionActions({ id: 1, allowed_actions: ['start', 'cancel'], can_update_execution: false })).toEqual(['start', 'cancel'])
    expect(resolutionActions({ id: 2, state: 'open', can_update_execution: true, can_edit_decision: false, task_id: null })).toEqual(['start', 'complete', 'edit_result'])
    expect(resolutionActions({ id: 3, state: 'done', can_update_execution: true, can_edit_decision: true, task_id: null })).toEqual([])
  })

  it('classifies calendar completeness without treating unknown totals as zero', () => {
    expect(calendarCoverage(18, 2000)).toEqual({ status: 'complete', total: 18 })
    expect(calendarCoverage(2001, 2000)).toEqual({ status: 'truncated', total: 2001 })
    expect(calendarCoverage(null, 2000)).toEqual({ status: 'unknown', total: null })
  })
})
