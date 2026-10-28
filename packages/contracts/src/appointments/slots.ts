import { z } from 'zod'

const utcTimestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** One free slot, as UTC timestamps. */
export const AppointmentSlotSchema = z.object({
  start: utcTimestamp,
  stop: utcTimestamp,
}).strict()

export const AppointmentSlotListSchema = z.object({
  items: z.array(AppointmentSlotSchema),
  total: z.number().int().nonnegative(),
}).strict()

/** Query of GET /appointments/types/{id}/slots: inclusive dates; `to` may not pass the company's booking horizon. */
export const AppointmentSlotQuerySchema = z.object({
  from: isoDate,
  to: isoDate,
  combination_id: z.number().int().positive(),
}).partial().required({ from: true, to: true }).strict()

export type AppointmentSlot = z.infer<typeof AppointmentSlotSchema>
export type AppointmentSlotList = z.infer<typeof AppointmentSlotListSchema>
export type AppointmentSlotQuery = z.infer<typeof AppointmentSlotQuerySchema>
