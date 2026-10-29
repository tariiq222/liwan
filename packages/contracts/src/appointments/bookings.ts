import { z } from 'zod'

const utcTimestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const positiveId = z.number().int().positive()

export const AppointmentBookingStateSchema = z.enum(['pending', 'scheduled', 'confirmed', 'canceled'])
/** What happened to a booking on the day, beside its state; null until staff record it. */
export const AppointmentAttendanceSchema = z.enum(['arrived', 'in_service', 'done', 'no_show'])

/** One booking in a list: the only requester data is the display name. `reference` is null on bookings made before references existed. */
export const AppointmentBookingRowSchema = z.object({
  id: positiveId,
  reference: z.string().nullable(),
  state: AppointmentBookingStateSchema,
  attendance: AppointmentAttendanceSchema.nullable(),
  walk_in: z.boolean(),
  type_id: positiveId,
  type_name: z.string(),
  combination_id: positiveId.nullable(),
  start: utcTimestamp.nullable(),
  stop: utcTimestamp.nullable(),
  duration_minutes: z.number().int().nonnegative(),
  requester_name: z.string(),
}).strict()

const reasonRef = z.object({ id: positiveId, name: z.string() }).strict()

/**
 * A booking in detail: the row plus the requester, national id, notes and reasons. The requester's phone and email and the
 * national id are null for a caller who only reads, and the national id is also null while the company hides that field.
 */
export const AppointmentBookingSchema = AppointmentBookingRowSchema.extend({
  requester: z.object({
    id: positiveId,
    name: z.string(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
  }).strict(),
  national_id: z.string().nullable(),
  notes: z.string().nullable(),
  visit_reason: reasonRef.nullable(),
  cancel_reason: reasonRef.nullable(),
  is_modifiable: z.boolean(),
}).strict()

export const AppointmentBookingListSchema = z.object({
  items: z.array(AppointmentBookingRowSchema),
  total: z.number().int().nonnegative(),
}).strict()

/** Query of GET /appointments/bookings: `from`/`to` are inclusive UTC dates on the start; `mine` limits to the caller's bookings. */
export const AppointmentBookingListQuerySchema = z.object({
  state: AppointmentBookingStateSchema,
  type_id: positiveId,
  resource_id: positiveId,
  from: isoDate,
  to: isoDate,
  mine: z.enum(['true', 'false']),
  limit: z.number().int().min(1).max(200),
  offset: z.number().int().nonnegative(),
}).partial().strict()

/** A new requester, created as a partner of the current company; phone and email follow the company's field policies. */
export const AppointmentRequesterSchema = z.object({
  name: z.string().min(1).max(255),
  phone: z.string().min(5).max(32).regex(/^\+?[0-9 ()-]+$/).nullable(),
  email: z.string().max(255).nullable(),
}).partial({ phone: true, email: true }).strict()

/**
 * POST /appointments/bookings: exactly one of `requester_id` (an existing partner) and `requester`. `national_id` and
 * `notes` and `visit_reason_id` follow the company's field policies. Without `start` the booking is pending; with it,
 * scheduled. `walk_in: true` (only while the company allows walk-ins) schedules it now, confirmed and arrived, and
 * excludes `start`.
 */
export const AppointmentBookingCreateSchema = z.object({
  type_id: positiveId,
  combination_id: positiveId,
  requester_id: positiveId,
  requester: AppointmentRequesterSchema,
  national_id: z.string().max(32).nullable(),
  notes: z.string().max(2000).nullable(),
  start: utcTimestamp,
  walk_in: z.boolean(),
  visit_reason_id: positiveId.nullable(),
}).partial().required({ type_id: true }).strict().refine(
  body => (body.requester_id === undefined) !== (body.requester === undefined),
  { message: 'send exactly one of requester_id and requester', path: ['requester'] },
).refine(
  body => !(body.walk_in && body.start !== undefined),
  { message: 'a walk-in starts now', path: ['start'] },
)

/** PATCH /appointments/bookings/{id}: the visit reason; null clears it unless the company requires one. */
export const AppointmentBookingPatchSchema = z.object({ visit_reason_id: positiveId.nullable() }).strict()

/** POST /appointments/bookings/{id}/cancel: the cancel reason is required while the company requires one. */
export const AppointmentBookingCancelSchema = z.object({ reason_id: positiveId.nullable() }).partial().strict()

/** POST /appointments/bookings/{id}/attendance: a move from none to arrived or no_show, arrived to in_service or done, in_service to done, no_show to arrived. */
export const AppointmentAttendanceRecordSchema = z.object({ outcome: AppointmentAttendanceSchema }).strict()

/** POST /appointments/bookings/{id}/schedule: schedules or reschedules; `combination_id` pins the resources. */
export const AppointmentBookingScheduleSchema = z.object({
  start: utcTimestamp,
  combination_id: positiveId,
}).partial().required({ start: true }).strict()

export type AppointmentAttendance = z.infer<typeof AppointmentAttendanceSchema>
export type AppointmentBookingState = z.infer<typeof AppointmentBookingStateSchema>
export type AppointmentBookingRow = z.infer<typeof AppointmentBookingRowSchema>
export type AppointmentBooking = z.infer<typeof AppointmentBookingSchema>
export type AppointmentBookingList = z.infer<typeof AppointmentBookingListSchema>
export type AppointmentBookingListQuery = z.infer<typeof AppointmentBookingListQuerySchema>
export type AppointmentBookingCreate = z.infer<typeof AppointmentBookingCreateSchema>
export type AppointmentBookingSchedule = z.infer<typeof AppointmentBookingScheduleSchema>
export type AppointmentBookingPatch = z.infer<typeof AppointmentBookingPatchSchema>
export type AppointmentBookingCancel = z.infer<typeof AppointmentBookingCancelSchema>
export type AppointmentAttendanceRecord = z.infer<typeof AppointmentAttendanceRecordSchema>
