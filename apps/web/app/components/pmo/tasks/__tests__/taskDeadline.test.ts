import { describe, expect, it } from 'vitest'
import { deadlineCellView, taskDaysRemaining } from '../taskDeadline'

describe('taskDaysRemaining', () => {
  const now = new Date(2026, 9, 15, 10, 0, 0)

  it('counts local calendar days from the deadline instant, ignoring the stale server value', () => {
    expect(taskDaysRemaining({ date_deadline: new Date(2026, 9, 18, 23, 30).toISOString(), days_remaining: 120 }, now)).toBe(3)
  })

  it('is zero on the deadline day at any hour and negative once it has passed', () => {
    expect(taskDaysRemaining({ date_deadline: new Date(2026, 9, 15, 0, 5).toISOString(), days_remaining: null }, now)).toBe(0)
    expect(taskDaysRemaining({ date_deadline: new Date(2026, 9, 12, 9).toISOString(), days_remaining: null }, now)).toBe(-3)
  })

  it('falls back to the server value when there is no usable deadline', () => {
    expect(taskDaysRemaining({ date_deadline: null, days_remaining: null }, now)).toBeNull()
    expect(taskDaysRemaining({ date_deadline: 'not a date', days_remaining: 4 }, now)).toBe(4)
  })
})

describe('deadlineCellView', () => {
  const now = new Date(2026, 9, 15, 10, 0, 0)
  const task = (day: number, is_closed = false) => ({ date_deadline: new Date(2026, 9, day, 12).toISOString(), days_remaining: null, is_closed })

  it('shows the plain date, in Latin digits', () => {
    expect(deadlineCellView(task(25), now)?.text).toContain('25/10/2026')
  })

  it('colours only an unfinished task that is overdue or due within three days', () => {
    expect(deadlineCellView(task(12), now)?.tone).toBe('overdue')
    expect(deadlineCellView(task(15), now)?.tone).toBe('soon')
    expect(deadlineCellView(task(18), now)?.tone).toBe('soon')
    expect(deadlineCellView(task(19), now)?.tone).toBeNull()
    expect(deadlineCellView(task(12, true), now)?.tone).toBeNull()
  })

  it('has no cell without a deadline', () => {
    expect(deadlineCellView({ date_deadline: null, days_remaining: null, is_closed: false }, now)).toBeNull()
  })
})
