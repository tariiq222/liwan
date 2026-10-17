import { describe, expect, it } from 'vitest'
import {
  daysRemaining,
  deadlineLabel,
  nextStates,
  PRIORITY_LABEL_KEY,
  STATE_LABEL_KEY,
  STATE_TONE,
} from '../taskState'

describe('daysRemaining', () => {
  it('counts by calendar date in UTC, not elapsed hours', () => {
    // Deadline is 2030-01-15 UTC; "now" is 2030-01-13 20:00 UTC (still the 13th) → 2 days.
    expect(daysRemaining('2030-01-15T09:00:00Z', new Date('2030-01-13T20:00:00Z'))).toBe(2)
  })

  it('returns 0 when the deadline is today', () => {
    expect(daysRemaining('2030-01-13T02:00:00Z', new Date('2030-01-13T20:00:00Z'))).toBe(0)
  })

  it('returns a negative number when the deadline has passed', () => {
    expect(daysRemaining('2030-01-10T09:00:00Z', new Date('2030-01-13T20:00:00Z'))).toBe(-3)
  })

  it('returns null for a missing deadline', () => {
    expect(daysRemaining(null)).toBeNull()
    expect(daysRemaining(undefined)).toBeNull()
    expect(daysRemaining('')).toBeNull()
  })
})

describe('deadlineLabel', () => {
  const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key)

  it('returns the "none" key for a null day count', () => {
    expect(deadlineLabel(null, t)).toBe('tasks.deadline.none')
  })

  it('returns the "today" key for 0', () => {
    expect(deadlineLabel(0, t)).toBe('tasks.deadline.today')
  })

  it('returns "inDays" with n=1 for tomorrow', () => {
    expect(deadlineLabel(1, t)).toBe('tasks.deadline.inDays:{"n":1}')
  })

  it('returns "inDays" with n for later days', () => {
    expect(deadlineLabel(5, t)).toBe('tasks.deadline.inDays:{"n":5}')
  })

  it('returns "overdueDays" with the absolute value for negative days', () => {
    expect(deadlineLabel(-3, t)).toBe('tasks.deadline.overdueDays:{"n":3}')
  })
})

describe('nextStates', () => {
  it('excludes the current state and manager states when canApprove is false', () => {
    expect(nextStates('done', false)).toEqual(['in_progress', 'waiting', 'cancelled'])
  })

  it('includes manager states when canApprove is true', () => {
    expect(nextStates('done', true)).toEqual(['in_progress', 'waiting', 'changes_requested', 'approved', 'cancelled'])
  })

  it('never includes the state itself', () => {
    for (const state of ['in_progress', 'waiting', 'changes_requested', 'approved', 'done', 'cancelled'] as const) {
      expect(nextStates(state, true)).not.toContain(state)
    }
  })
})

describe('STATE_LABEL_KEY', () => {
  it('has a tasks.state.<x> key for every state', () => {
    for (const state of ['in_progress', 'waiting', 'changes_requested', 'approved', 'done', 'cancelled'] as const) {
      expect(STATE_LABEL_KEY[state]).toBe(`tasks.state.${state}`)
    }
  })
})

describe('STATE_TONE', () => {
  it('has a tone for every state', () => {
    for (const state of ['in_progress', 'waiting', 'changes_requested', 'approved', 'done', 'cancelled'] as const) {
      expect(STATE_TONE[state]).toBeTruthy()
    }
  })
})

describe('PRIORITY_LABEL_KEY', () => {
  it('maps all four priority values to tasks.priority.<n>', () => {
    expect(PRIORITY_LABEL_KEY['0']).toBe('tasks.priority.0')
    expect(PRIORITY_LABEL_KEY['1']).toBe('tasks.priority.1')
    expect(PRIORITY_LABEL_KEY['2']).toBe('tasks.priority.2')
    expect(PRIORITY_LABEL_KEY['3']).toBe('tasks.priority.3')
  })
})
