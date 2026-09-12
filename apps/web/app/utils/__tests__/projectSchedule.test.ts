import { describe, expect, it } from 'vitest'
import { addCalendarDays, buildScheduleAxis, daysBetween, formatScheduleDate, scheduleBarStyle, scheduleDatePosition } from '../projectSchedule'
import { isCalendarDate } from '../../composables/calendarDate'

const task = { id: 1, name: 'Build', start: '2030-01-05', end: '2030-01-12', state: 'in_progress' as const, dependency_ids: [], milestone_id: null }

describe('project schedule date math', () => {
  it('uses UTC calendar arithmetic without shifting dates', () => {
    expect(isCalendarDate('2030-02-30')).toBe(false)
    expect(isCalendarDate('2030-02-01')).toBe(true)
    expect(addCalendarDays('2030-01-31', 1)).toBe('2030-02-01')
    expect(daysBetween('2030-01-05', '2030-01-12')).toBe(7)
    expect(formatScheduleDate('2030-02-01', 'en-US')).toContain('Feb 1')
  })

  it('builds a bounded axis and hides undated bars', () => {
    const axis = buildScheduleAxis([task], [], 'week')
    expect(axis.dates.length).toBeGreaterThan(1)
    expect(axis.dates.length).toBeLessThan(600)
    expect(scheduleBarStyle(task, axis)).toHaveProperty('width')
    const bar = scheduleBarStyle(task, axis)
    const tick = scheduleDatePosition('2030-01-05', axis)
    expect(Number.parseFloat(String(bar.insetInlineStart))).toBeCloseTo(Number.parseFloat(String(tick.insetInlineStart)), 6)
    expect(Number.parseFloat(String(scheduleDatePosition(axis.end, axis).insetInlineStart))).toBe(100)
    expect(scheduleBarStyle({ start: null, end: null }, axis)).toEqual({ display: 'none' })
    const long = buildScheduleAxis([{ ...task, start: '2030-01-01', end: '2050-01-01' }], [], 'week')
    expect(long.dates.length).toBeLessThanOrEqual(48)
    expect(long.dates.length).toBe(long.totalDays / long.unitDays)
    expect(daysBetween(long.start, long.end)).toBe(long.totalDays)
  })

  it('spans the project dates when tasks are undated', () => {
    const axis = buildScheduleAxis([], [], 'week', { start: '2030-01-01', end: '2030-02-12' })
    expect(axis.start).toBe('2030-01-01')
    expect(axis.dates.length).toBeGreaterThanOrEqual(6)
    expect(daysBetween(axis.start, axis.end)).toBeGreaterThanOrEqual(42)
  })
})
