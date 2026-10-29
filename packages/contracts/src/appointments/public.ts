import { z } from 'zod'

const utcTimestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const accessToken = z.string().min(1).max(128)

/** POST /appointments/bookings/{id}/invitation: the page path of the requester, with the booking's access token. */
export const AppointmentInvitationSchema = z.object({
  path: z.string().regex(/^\/book\/\d+\?access_token=[^&#\s]+$/),
}).strict()

/**
 * A booking as the invited requester sees it (GET /public/appointments/bookings/{id}): the requester's own name,
 * phone and email only, each null while the company hides that field. Never a partner id, the national id, notes
 * or any resource user.
 */
export const AppointmentPublicBookingSchema = z.object({
  id: z.number().int().positive(),
  state: z.enum(['pending', 'scheduled', 'confirmed', 'canceled']),
  type_name: z.string(),
  duration_minutes: z.number().int().nonnegative(),
  location: z.string().nullable(),
  start: utcTimestamp.nullable(),
  stop: utcTimestamp.nullable(),
  is_modifiable: z.boolean(),
  company_name: z.string(),
  requester: z.object({
    name: z.string(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
  }).strict(),
}).strict()

/** Query of GET /public/appointments/bookings/{id}: the access token only. */
export const AppointmentPublicBookingQuerySchema = z.object({
  access_token: accessToken,
}).strict()

/** Query of GET /public/appointments/bookings/{id}/slots: inclusive dates; `to` may not pass the company's booking horizon. */
export const AppointmentPublicSlotQuerySchema = z.object({
  access_token: accessToken,
  from: isoDate,
  to: isoDate,
}).strict()

/** Body of POST /public/appointments/bookings/{id}/schedule: schedules or reschedules on one of the listed slots. */
export const AppointmentPublicScheduleSchema = z.object({
  access_token: accessToken,
  start: utcTimestamp,
}).strict()

/** Body of POST /public/appointments/bookings/{id}/confirm and /cancel. */
export const AppointmentPublicTokenSchema = z.object({
  access_token: accessToken,
}).strict()

export type AppointmentInvitation = z.infer<typeof AppointmentInvitationSchema>
export type AppointmentPublicBooking = z.infer<typeof AppointmentPublicBookingSchema>
export type AppointmentPublicBookingQuery = z.infer<typeof AppointmentPublicBookingQuerySchema>
export type AppointmentPublicSlotQuery = z.infer<typeof AppointmentPublicSlotQuerySchema>
export type AppointmentPublicSchedule = z.infer<typeof AppointmentPublicScheduleSchema>
export type AppointmentPublicToken = z.infer<typeof AppointmentPublicTokenSchema>
