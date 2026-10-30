import { describe, expect, it } from 'vitest'
import { deadlineTag } from '../taskState'

describe('deadlineTag', () => {
  it('is danger with an timer-off icon when overdue, warning with an alarm clock today, success (green) with an hourglass later', () => {
    expect(deadlineTag(-3, false)).toEqual({ tone: 'destructive', icon: 'i-lucide-timer-off' })
    expect(deadlineTag(0, false)).toEqual({ tone: 'warning', icon: 'i-lucide-alarm-clock' })
    expect(deadlineTag(1, false)).toEqual({ tone: 'warning', icon: 'i-lucide-hourglass' })
    expect(deadlineTag(2, false)?.tone).toBe('warning')
    expect(deadlineTag(3, false)).toEqual({ tone: 'info', icon: 'i-lucide-hourglass' })
  })
  it('has no tag without a deadline and never marks a closed task urgent', () => {
    expect(deadlineTag(null, false)).toBeNull()
    expect(deadlineTag(-3, true)).toEqual({ tone: 'neutral', icon: 'i-lucide-calendar-check' })
    expect(deadlineTag(0, true)?.tone).toBe('neutral')
  })
})
