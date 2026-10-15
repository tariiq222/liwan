import { describe, expect, it } from 'vitest'
import {
  meetingStateBadge, meetingStateBadgeProps,
  resolutionStateBadge, resolutionStateBadgeProps,
} from '../meetingStatus'

describe('meeting status badges', () => {
  it('give every meeting state one semantic tone', () => {
    const tones = { draft: 'neutral', confirmed: 'info', done: 'success', cancelled: 'destructive' }
    for (const [state, tone] of Object.entries(tones)) expect(meetingStateBadge(state).tone, state).toBe(tone)
    for (const state of ['unknown', null, undefined]) expect(meetingStateBadge(state).tone, String(state)).toBe('neutral')
  })

  it('give every recommendation state, and the follow-up filters, one semantic tone', () => {
    const tones = { open: 'info', in_progress: 'warning', done: 'success', cancelled: 'destructive', active: 'info', overdue: 'destructive' }
    for (const [state, tone] of Object.entries(tones)) expect(resolutionStateBadge(state).tone, state).toBe(tone)
    for (const state of ['unknown', null]) expect(resolutionStateBadge(state).tone, String(state)).toBe('neutral')
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
