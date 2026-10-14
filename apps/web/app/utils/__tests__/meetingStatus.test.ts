import { describe, expect, it } from 'vitest'
import {
  meetingStateBadge, meetingStateBadgeProps, meetingStateColor,
  resolutionStateBadge, resolutionStateBadgeProps, resolutionStateColor,
} from '../meetingStatus'
import { STATUS_COLOR } from '../statusTone'

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

describe('meeting status badges', () => {
  it('give every meeting state the tone whose colour the old helper returned', () => {
    for (const state of ['draft', 'confirmed', 'done', 'cancelled', 'unknown', null, undefined]) {
      expect(STATUS_COLOR[meetingStateBadge(state).tone], String(state)).toBe(meetingStateColor(state))
    }
  })

  it('give every recommendation state, and the follow-up filters, the tone the old helper returned', () => {
    for (const state of ['open', 'in_progress', 'done', 'cancelled', 'active', 'overdue', 'unknown', null]) {
      expect(STATUS_COLOR[resolutionStateBadge(state).tone], String(state)).toBe(resolutionStateColor(state))
    }
  })

  it('translate through the label key, then the raw value, then a dash', () => {
    const t = (key: string) => `t:${key}`
    expect(meetingStateBadgeProps('confirmed', t)).toEqual({ tone: 'info', label: 't:meetingsUi.state.confirmed' })
    expect(meetingStateBadgeProps('from-a-newer-server', t)).toEqual({ tone: 'neutral', label: 'from-a-newer-server' })
    expect(meetingStateBadgeProps(null, t)).toEqual({ tone: 'neutral', label: '—' })
    expect(resolutionStateBadgeProps('in_progress', t)).toEqual({ tone: 'warning', label: 't:meetingsUi.resolutionState.in_progress' })
  })

  it('lets the caller word the follow-up filters', () => {
    const t = (key: string) => `t:${key}`
    expect(resolutionStateBadgeProps('overdue', t, 'Overdue')).toEqual({ tone: 'destructive', label: 'Overdue' })
    expect(resolutionStateBadgeProps('active', t)).toEqual({ tone: 'info', label: 'active' })
  })
})
