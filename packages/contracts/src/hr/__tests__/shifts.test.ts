import { describe, expect, it } from 'vitest'
import {
  HrShiftAssignmentCreateSchema,
  HrShiftAssignmentListSchema,
  HrShiftAssignmentPatchSchema,
  HrShiftAssignmentSchema,
  HrShiftAttendanceSchema,
  HrShiftScheduleCreateSchema,
  HrShiftScheduleListSchema,
  HrShiftSchedulePatchSchema,
  HrShiftScheduleSchema,
} from '..'

const ATTENDANCE = {
  dayofweek: '0',
  day_period: 'morning',
  hour_from: 8,
  hour_to: 12,
  week_type: null,
}

const SCHEDULE = {
  id: 5,
  name: 'وردية صباحية',
  tz: 'Asia/Riyadh',
  two_weeks: false,
  hours_per_week: 40,
  active: true,
  attendances: [ATTENDANCE, { ...ATTENDANCE, day_period: 'afternoon', hour_from: 13, hour_to: 17 }],
}

const ASSIGNMENT = {
  id: 9,
  employee: { id: 10, name: 'Noura' },
  schedule: { id: 5, name: 'وردية صباحية' },
  date_start: '2026-11-01',
  date_end: null,
}

describe('HrShiftScheduleSchema', () => {
  it('accepts a schedule with its attendance lines inside a list', () => {
    const parsed = HrShiftScheduleListSchema.parse({ items: [SCHEDULE], total: 1 })
    expect(parsed.items[0]?.attendances).toHaveLength(2)
    expect(parsed.items[0]?.hours_per_week).toBe(40)
  })

  it('accepts a two-week schedule line and an open-ended schedule', () => {
    const twoWeeks = {
      ...SCHEDULE,
      two_weeks: true,
      attendances: [{ ...ATTENDANCE, week_type: '1' }],
    }
    expect(HrShiftScheduleSchema.parse(twoWeeks).attendances[0]?.week_type).toBe('1')
    expect(HrShiftScheduleSchema.parse({ ...SCHEDULE, attendances: [] }).attendances).toEqual([])
  })

  it('rejects an unknown day, period, week type and extra keys', () => {
    expect(() => HrShiftAttendanceSchema.parse({ ...ATTENDANCE, dayofweek: '7' })).toThrow()
    expect(() => HrShiftAttendanceSchema.parse({ ...ATTENDANCE, day_period: 'night' })).toThrow()
    expect(() => HrShiftAttendanceSchema.parse({ ...ATTENDANCE, week_type: '2' })).toThrow()
    expect(() => HrShiftScheduleSchema.parse({ ...SCHEDULE, leave_ids: [1] })).toThrow()
    expect(() => HrShiftScheduleListSchema.parse({ items: [SCHEDULE] })).toThrow()
  })
})

describe('shift writes', () => {
  it('requires at least one attendance on create and refuses two-week creation', () => {
    expect(HrShiftScheduleCreateSchema.parse({ name: 'صباحية', tz: 'Asia/Riyadh', attendances: [ATTENDANCE] }).name).toBe('صباحية')
    expect(() => HrShiftScheduleCreateSchema.parse({ name: 'صباحية', tz: 'Asia/Riyadh', attendances: [] })).toThrow()
    expect(() => HrShiftScheduleCreateSchema.parse({ name: 'صباحية', tz: 'Asia/Riyadh', attendances: [ATTENDANCE], two_weeks: true })).toThrow()
  })

  it('accepts patches that replace the attendances and rejects empty ones', () => {
    expect(HrShiftSchedulePatchSchema.parse({ attendances: [ATTENDANCE] }).attendances).toHaveLength(1)
    expect(() => HrShiftSchedulePatchSchema.parse({})).toThrow()
    expect(() => HrShiftSchedulePatchSchema.parse({ attendances: [] })).toThrow()
  })
})

describe('HrShiftAssignmentSchema', () => {
  it('accepts dated assignments inside the list envelope', () => {
    const closed = { ...ASSIGNMENT, id: 10, date_start: null, date_end: '2026-12-31' }
    const parsed = HrShiftAssignmentListSchema.parse({ items: [ASSIGNMENT, closed], total: 2 })
    expect(parsed.items[0]?.date_end).toBeNull()
    expect(HrShiftAssignmentSchema.parse(closed).date_end).toBe('2026-12-31')
  })

  it('validates creates, their date order and non-empty patches', () => {
    expect(HrShiftAssignmentCreateSchema.parse({ employee_id: 10, schedule_id: 5 }).employee_id).toBe(10)
    expect(HrShiftAssignmentCreateSchema.parse({
      employee_id: 10, schedule_id: 5, date_start: '2026-11-01', date_end: '2026-11-30',
    }).date_end).toBe('2026-11-30')
    expect(() => HrShiftAssignmentCreateSchema.parse({
      employee_id: 10, schedule_id: 5, date_start: '2026-11-30', date_end: '2026-11-01',
    })).toThrow()
    expect(HrShiftAssignmentPatchSchema.parse({ schedule_id: 6 }).schedule_id).toBe(6)
    expect(() => HrShiftAssignmentPatchSchema.parse({})).toThrow()
    expect(() => HrShiftAssignmentCreateSchema.parse({ employee_id: 10 })).toThrow()
  })

  it('rejects an assignment payload that names the employee twice', () => {
    expect(() => HrShiftAssignmentSchema.parse({ ...ASSIGNMENT, employee_id: 10 })).toThrow()
  })
})
