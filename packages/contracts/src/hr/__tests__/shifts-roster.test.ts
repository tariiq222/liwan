import { describe, expect, it } from 'vitest'
import { HrShiftMyWeekSchema, HrShiftRosterSchema, HrShiftWeekSetSchema } from '..'

const day = (date: string, shifts: object[] = []) => ({ date, schedule: { id: 3, name: 'Day' }, shifts })
const DAYS = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']
const WEEK = {
  employee: { id: 9, name: 'Sara' },
  days: DAYS.map((date, index) => day(date, index === 1 ? [{ hour_from: 8, hour_to: 12, day_period: 'morning' }] : [])),
}

describe('the weekly shift table contracts', () => {
  it('accepts a roster page and a personal week of seven days', () => {
    expect(HrShiftRosterSchema.parse({ week_start: '2026-11-01', items: [WEEK], total: 1 }).items).toHaveLength(1)
    expect(HrShiftMyWeekSchema.parse({ week_start: '2026-11-01', ...WEEK }).days).toHaveLength(7)
  })

  it('allows a day without a schedule and refuses a short week or an extra field', () => {
    const open = { ...WEEK, days: WEEK.days.map(item => ({ ...item, schedule: null })) }
    expect(HrShiftRosterSchema.safeParse({ week_start: '2026-11-01', items: [open], total: 1 }).success).toBe(true)
    expect(HrShiftRosterSchema.safeParse({ week_start: '2026-11-01', items: [{ ...WEEK, days: WEEK.days.slice(0, 6) }], total: 1 }).success).toBe(false)
    expect(HrShiftRosterSchema.safeParse({ week_start: '2026-11-01', items: [{ ...WEEK, extra: 1 }], total: 1 }).success).toBe(false)
  })

  it('requires all three fields to set a week', () => {
    expect(HrShiftWeekSetSchema.parse({ employee_id: 1, schedule_id: 2, week_start: '2026-11-01' })).toBeTruthy()
    for (const invalid of [{ employee_id: 1, schedule_id: 2 }, { employee_id: 0, schedule_id: 2, week_start: '2026-11-01' }, { employee_id: 1, schedule_id: 2, week_start: 'x' }]) {
      expect(HrShiftWeekSetSchema.safeParse(invalid).success).toBe(false)
    }
  })
})
