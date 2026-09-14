import { describe, expect, it } from 'vitest'
import { meetingStateColor, resolutionStateColor } from '../meetingStatus'

describe('meeting status colours', () => {
  it('maps every meeting state to one semantic badge colour', () => {
    expect(meetingStateColor('draft')).toBe('neutral')
    expect(meetingStateColor('confirmed')).toBe('info')
    expect(meetingStateColor('done')).toBe('success')
    expect(meetingStateColor('cancelled')).toBe('error')
    expect(meetingStateColor('unknown')).toBe('neutral')
  })

  it('maps every resolution state to one semantic badge colour', () => {
    expect(resolutionStateColor('open')).toBe('info')
    expect(resolutionStateColor('in_progress')).toBe('warning')
    expect(resolutionStateColor('done')).toBe('success')
    expect(resolutionStateColor('cancelled')).toBe('error')
    expect(resolutionStateColor('overdue')).toBe('error')
    expect(resolutionStateColor('active')).toBe('info')
    expect(resolutionStateColor(null)).toBe('neutral')
  })
})
