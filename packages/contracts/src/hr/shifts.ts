import { z } from 'zod'
import { HrRefSchema } from './ref'

/** The shifts area (`/api/v1/hr/shifts`), over the OCA hr_employee_calendar_planning engine. */
const isoDate = z.iso.date()
const nonEmptyTrimmedName = z.string().trim().min(1)
const requirePatchField = (value: object) => Object.keys(value).length > 0
const hour = z.number().min(0).max(24)

export const HrShiftAttendanceSchema = z.object({
  dayofweek: z.enum(['0', '1', '2', '3', '4', '5', '6']),
  day_period: z.enum(['morning', 'lunch', 'afternoon', 'full_day']),
  hour_from: hour,
  hour_to: hour,
  week_type: z.enum(['0', '1']).nullable(),
}).strict()

export const HrShiftScheduleSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  tz: z.string(),
  two_weeks: z.boolean(),
  hours_per_week: z.number().nonnegative(),
  active: z.boolean(),
  attendances: z.array(HrShiftAttendanceSchema),
}).strict()

export const HrShiftScheduleListSchema = z.object({
  items: z.array(HrShiftScheduleSchema),
  total: z.number().int().nonnegative(),
}).strict()

export const HrShiftScheduleCreateSchema = z.object({
  name: nonEmptyTrimmedName,
  tz: z.string(),
  two_weeks: z.literal(false).optional(),
  attendances: z.array(HrShiftAttendanceSchema).min(1),
}).strict()

export const HrShiftSchedulePatchSchema = z.object({
  name: nonEmptyTrimmedName.optional(),
  tz: z.string().optional(),
  // The set replaces the schedule's lines; an empty set is refused.
  attendances: z.array(HrShiftAttendanceSchema).min(1).optional(),
}).strict().refine(requirePatchField, { message: 'At least one field is required' })

export const HrShiftAssignmentSchema = z.object({
  id: z.number().int().positive(),
  employee: HrRefSchema,
  schedule: HrRefSchema,
  date_start: isoDate.nullable(),
  date_end: isoDate.nullable(),
}).strict()

export const HrShiftAssignmentListSchema = z.object({
  items: z.array(HrShiftAssignmentSchema),
  total: z.number().int().nonnegative(),
}).strict()

export const HrShiftAssignmentCreateSchema = z.object({
  employee_id: z.number().int().positive(),
  schedule_id: z.number().int().positive(),
  date_start: isoDate.optional(),
  date_end: isoDate.optional(),
}).strict().refine(
  value => !value.date_start || !value.date_end || value.date_start <= value.date_end,
  { message: 'date_end is before date_start', path: ['date_end'] },
)

export const HrShiftAssignmentPatchSchema = z.object({
  schedule_id: z.number().int().positive().optional(),
  date_start: isoDate.nullable().optional(),
  date_end: isoDate.nullable().optional(),
}).strict().refine(requirePatchField, { message: 'At least one field is required' })

export type HrShiftAttendance = z.infer<typeof HrShiftAttendanceSchema>
export type HrShiftSchedule = z.infer<typeof HrShiftScheduleSchema>
export type HrShiftScheduleList = z.infer<typeof HrShiftScheduleListSchema>
export type HrShiftScheduleCreate = z.infer<typeof HrShiftScheduleCreateSchema>
export type HrShiftSchedulePatch = z.infer<typeof HrShiftSchedulePatchSchema>
export type HrShiftAssignment = z.infer<typeof HrShiftAssignmentSchema>
export type HrShiftAssignmentList = z.infer<typeof HrShiftAssignmentListSchema>
export type HrShiftAssignmentCreate = z.infer<typeof HrShiftAssignmentCreateSchema>
export type HrShiftAssignmentPatch = z.infer<typeof HrShiftAssignmentPatchSchema>

/** Calendar-day reference of the current company. `today` is resolved by the server. */
export const HrShiftSettingsSchema = z.object({
  day_reference: z.enum(['company', 'user']),
  company_timezone: z.string().min(1),
  effective_timezone: z.string().min(1),
  today: isoDate,
  revision: z.number().int().nonnegative(),
}).strict()

export const HrShiftSettingsPatchSchema = z.object({
  day_reference: z.enum(['company', 'user']),
  revision: z.number().int().nonnegative(),
}).strict()
export type HrShiftSettings = z.infer<typeof HrShiftSettingsSchema>
export type HrShiftSettingsPatch = z.infer<typeof HrShiftSettingsPatchSchema>
