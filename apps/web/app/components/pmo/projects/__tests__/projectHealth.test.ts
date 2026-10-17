import { describe, expect, it } from 'vitest'
import { projectDaysRemaining, projectEndTagView, projectIsFinished, projectProgressTone, projectStatusPill } from '../projectHealth'

const now = new Date(2026, 9, 17, 15, 30)
const t = (key: string, params?: Record<string, unknown>) => `${key}${params ? JSON.stringify(params) : ''}`

describe('projectHealth', () => {
  it('counts calendar days to the end date in the local zone', () => {
    expect(projectDaysRemaining('2026-10-17', now)).toBe(0)
    expect(projectDaysRemaining('2026-10-20', now)).toBe(3)
    expect(projectDaysRemaining('2026-10-10', now)).toBe(-7)
    expect(projectDaysRemaining(null, now)).toBeNull()
    expect(projectDaysRemaining('not a date', now)).toBeNull()
  })

  it('treats a done project or a full bar as finished', () => {
    expect(projectIsFinished({ status: 'done', progress: 20 })).toBe(true)
    expect(projectIsFinished({ status: 'on_track', progress: 100 })).toBe(true)
    expect(projectIsFinished({ status: null, progress: 99 })).toBe(false)
  })

  it('picks the progress tone: finished wins, then late, then at risk', () => {
    expect(projectProgressTone({ status: 'on_track', progress: 100, date_end: '2020-01-01' }, now)).toBe('success')
    expect(projectProgressTone({ status: 'on_track', progress: 40, date_end: '2026-10-01' }, now)).toBe('danger')
    expect(projectProgressTone({ status: 'off_track', progress: 40, date_end: null }, now)).toBe('danger')
    expect(projectProgressTone({ status: 'at_risk', progress: 40, date_end: '2027-01-01' }, now)).toBe('warning')
    expect(projectProgressTone({ status: null, progress: 40, date_end: '2027-01-01' }, now)).toBe('primary')
  })

  it('draws no end-date pill without an end date, a late pill in danger, a finished one neutral', () => {
    expect(projectEndTagView({ status: null, progress: 0, date_end: null }, t, now)).toBeNull()
    expect(projectEndTagView({ status: 'on_track', progress: 10, date_end: '2026-10-10' }, t, now)).toMatchObject({ tone: 'destructive', icon: 'i-lucide-timer-off' })
    expect(projectEndTagView({ status: 'done', progress: 100, date_end: '2026-10-10' }, t, now)).toMatchObject({ tone: 'neutral', icon: 'i-lucide-calendar-check' })
  })

  it('reads an unset status as its own pill', () => {
    expect(projectStatusPill(null, t)).toEqual({ tone: 'neutral', label: 'projects.status.unset' })
    expect(projectStatusPill('at_risk', t)).toEqual({ tone: 'warning', label: 'projects.status.at_risk' })
  })
})
