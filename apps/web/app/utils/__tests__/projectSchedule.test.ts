import { describe, expect, it } from 'vitest'
import { addCalendarDays, addCalendarMonths, scheduleColumnLastDay, buildScheduleAxis, daysBetween, formatScheduleDate, scheduleBarStyle, scheduleColumnSpan, scheduleDatePosition, scheduleFocusDate } from '../projectSchedule'
import { isCalendarDate } from '@liwan/ui/app/composables/calendarDate'

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

describe('scheduleFocusDate', () => {
  const axis = { start: '2026-01-01', end: '2035-12-31' }

  it('focuses today while the project is running', () => {
    expect(scheduleFocusDate(axis, '2026-09-15')).toBe('2026-09-15')
  })

  it('falls back to the timeline start when today is outside it', () => {
    expect(scheduleFocusDate(axis, '2025-06-01')).toBe('2026-01-01')
    expect(scheduleFocusDate(axis, '2036-01-01')).toBe('2026-01-01')
    expect(scheduleFocusDate(axis, '')).toBe('2026-01-01')
  })
})

describe('scheduleColumnSpan', () => {
  it('reports a plain week or month when the axis is not grouped', () => {
    const task10w = { ...task, start: '2030-01-01', end: '2030-03-01' }
    expect(scheduleColumnSpan(buildScheduleAxis([task10w], [], 'week'), 'week', 'ar')).toEqual({ unit: 'week', count: 1, form: 'one' })
    expect(scheduleColumnSpan(buildScheduleAxis([task10w], [], 'month'), 'month', 'ar')).toEqual({ unit: 'month', count: 1, form: 'one' })
  })

  it('reports grouped columns on a long project', () => {
    const axis = buildScheduleAxis([], [], 'week', { start: '2026-01-01', end: '2035-12-31' })
    expect(axis.unitDays).toBe(77)
    expect(scheduleColumnSpan(axis, 'week', 'ar')).toEqual({ unit: 'week', count: 11, form: 'many' })
  })

  it('picks the plural form of the UI locale', () => {
    expect([1, 2, 3, 10, 11, 100].map(n => scheduleColumnSpan({ unitDays: n * 7 }, 'week', 'ar').form))
      .toEqual(['one', 'two', 'few', 'few', 'many', 'other'])
    expect([1, 11].map(n => scheduleColumnSpan({ unitDays: n * 30 }, 'month', 'en').form)).toEqual(['one', 'other'])
  })
})

describe('calendar-month schedule columns', () => {
  it('starts every column on the 1st of a month', () => {
    const axis = buildScheduleAxis([], [], 'month', { start: '2026-10-01', end: '2027-03-31' })
    expect(axis.dates).toEqual(['2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01'])
    expect(axis.end).toBe('2027-04-01')
    expect(axis.totalDays).toBe(daysBetween('2026-10-01', '2027-04-01'))
  })

  it('opens on the 1st of the first month even when the first date is mid-month', () => {
    const axis = buildScheduleAxis([{ ...task, start: '2030-01-17', end: '2030-02-03' }], [], 'month')
    expect(axis.start).toBe('2030-01-01')
    expect(axis.dates).toEqual(['2030-01-01', '2030-02-01'])
  })

  it('rolls over the year and ends each column on its own last day', () => {
    expect(addCalendarMonths('2026-11-15', 2)).toBe('2027-01-01')
    expect(addCalendarMonths('2026-12-01', 13)).toBe('2028-01-01')
    const axis = buildScheduleAxis([], [], 'month', { start: '2027-01-10', end: '2027-03-02' })
    expect(axis.dates.map((_, index) => scheduleColumnLastDay(axis, index))).toEqual(['2027-01-31', '2027-02-28', '2027-03-31'])
  })

  it('places a date inside its own month column, not on a 30-day step', () => {
    const axis = buildScheduleAxis([], [], 'month', { start: '2026-10-01', end: '2026-12-31' })
    const at = (date: string) => Number.parseFloat(String(scheduleDatePosition(date, axis).insetInlineStart))
    expect(at('2026-11-01')).toBeCloseTo(100 / 3, 6)
    expect(at('2026-12-01')).toBeCloseTo(200 / 3, 6)
    expect(at('2026-10-16')).toBeCloseTo((15 / 31) * (100 / 3), 6)
    expect(at('2027-01-01')).toBe(100)
    const bar = scheduleBarStyle({ start: '2026-11-01', end: '2026-11-30' }, axis)
    expect(Number.parseFloat(String(bar.width))).toBeCloseTo(100 / 3, 6)
  })

  it('groups months once a project needs more than 48 columns', () => {
    const axis = buildScheduleAxis([], [], 'month', { start: '2026-01-01', end: '2035-12-31' })
    expect(axis.dates.length).toBeLessThanOrEqual(48)
    expect(axis.unitDays).toBe(90)
    expect(scheduleColumnSpan(axis, 'month', 'en')).toMatchObject({ unit: 'month', count: 3 })
    expect(axis.dates.slice(0, 2)).toEqual(['2026-01-01', '2026-04-01'])
  })
})
