import { z } from 'zod'

const name = z.string().trim().min(1).max(255)
const optionalText = z.string().trim().max(255).nullable()
const durationMinutes = z.number().int().min(1).max(1440)
const slotMinutes = z.number().int().min(5).max(480)
const modificationsDeadlineHours = z.number().int().min(0).max(720)
const id = z.number().int().positive()

/**
 * One booking type. Minutes and hours are the wire units; the engine stores hours as floats.
 * `modifications_deadline_hours` is the deadline the routes enforce (the type's own, or its company's setting);
 * `own_deadline_hours` is null while the type follows the company (issue #551).
 */
export const AppointmentTypeSchema = z.object({
  id,
  name: z.string(),
  duration_minutes: durationMinutes,
  slot_minutes: slotMinutes,
  modifications_deadline_hours: modificationsDeadlineHours,
  own_deadline_hours: modificationsDeadlineHours.nullable(),
  location: z.string().nullable(),
  videocall_location: z.string().nullable(),
  resource_calendar_id: id,
  combination_ids: z.array(id),
  active: z.boolean(),
}).strict()

export const AppointmentTypeListSchema = z.object({
  items: z.array(AppointmentTypeSchema),
  total: z.number().int().nonnegative(),
}).strict()

/**
 * POST /appointments/types: `name` is required. An omitted slot length takes the company settings' default and an
 * omitted `own_deadline_hours` makes the type follow the company's modification deadline; an omitted calendar is the
 * company's own; `combination_ids` keeps the order sent.
 */
export const AppointmentTypeCreateSchema = z.object({
  name,
  duration_minutes: durationMinutes,
  slot_minutes: slotMinutes,
  own_deadline_hours: modificationsDeadlineHours.nullable(),
  location: optionalText,
  videocall_location: optionalText,
  resource_calendar_id: id,
  combination_ids: z.array(id),
}).partial().required({ name: true }).strict()

/** PATCH /appointments/types/{id}: any subset of the create fields; archive and unarchive are their own routes. */
export const AppointmentTypePatchSchema = AppointmentTypeCreateSchema.partial().strict()

export type AppointmentType = z.infer<typeof AppointmentTypeSchema>
export type AppointmentTypeList = z.infer<typeof AppointmentTypeListSchema>
export type AppointmentTypeCreate = z.infer<typeof AppointmentTypeCreateSchema>
export type AppointmentTypePatch = z.infer<typeof AppointmentTypePatchSchema>
