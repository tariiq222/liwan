import { z } from 'zod'

const utcTimestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const positiveId = z.number().int().positive()

export const AppointmentBookingStateSchema = z.enum(['pending', 'scheduled', 'confirmed', 'canceled'])

/** One booking in a list: the only requester data is the display name. */
export const AppointmentBookingRowSchema = z.object({
  id: positiveId,
  state: AppointmentBookingStateSchema,
  type_id: positiveId,
  type_name: z.string(),
  combination_id: positiveId.nullable(),
  start: utcTimestamp.nullable(),
  stop: utcTimestamp.nullable(),
  duration_minutes: z.number().int().nonnegative(),
  requester_name: z.string(),
}).strict()

/**
 * A booking in detail: the row plus the requester, national id and notes. The requester's phone and email and the
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
 * `notes` follow the company's field policies. Without `start` the booking is pending; with it, scheduled.
 */
export const AppointmentBookingCreateSchema = z.object({
  type_id: positiveId,
  combination_id: positiveId,
  requester_id: positiveId,
  requester: AppointmentRequesterSchema,
  national_id: z.string().max(32).nullable(),
  notes: z.string().max(2000).nullable(),
  start: utcTimestamp,
}).partial().required({ type_id: true }).strict().refine(
  body => (body.requester_id === undefined) !== (body.requester === undefined),
  { message: 'send exactly one of requester_id and requester', path: ['requester'] },
)

/** POST /appointments/bookings/{id}/schedule: schedules or reschedules; `combination_id` pins the resources. */
export const AppointmentBookingScheduleSchema = z.object({
  start: utcTimestamp,
  combination_id: positiveId,
}).partial().required({ start: true }).strict()

export type AppointmentBookingState = z.infer<typeof AppointmentBookingStateSchema>
export type AppointmentBookingRow = z.infer<typeof AppointmentBookingRowSchema>
export type AppointmentBooking = z.infer<typeof AppointmentBookingSchema>
export type AppointmentBookingList = z.infer<typeof AppointmentBookingListSchema>
export type AppointmentBookingListQuery = z.infer<typeof AppointmentBookingListQuerySchema>
export type AppointmentBookingCreate = z.infer<typeof AppointmentBookingCreateSchema>
export type AppointmentBookingSchedule = z.infer<typeof AppointmentBookingScheduleSchema>
