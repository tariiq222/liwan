import { z } from 'zod'

const id = z.number().int().positive()
const name = z.string().trim().min(1).max(255)
const sequence = z.number().int().min(0).max(9999)

export const AppointmentReasonKindSchema = z.enum(['visit', 'cancel'])

/** One entry of a company's visit-reason or cancel-reason list; `name` is in the caller's language. */
export const AppointmentReasonSchema = z.object({
  id,
  kind: AppointmentReasonKindSchema,
  name: z.string(),
  sequence,
  active: z.boolean(),
}).strict()

export const AppointmentReasonListSchema = z.object({
  items: z.array(AppointmentReasonSchema),
  total: z.number().int().nonnegative(),
}).strict()

/** Query of GET /appointments/reasons: active reasons by default, `active=false` lists the archived ones. */
export const AppointmentReasonListQuerySchema = z.object({
  kind: AppointmentReasonKindSchema,
  active: z.enum(['true', 'false']),
  limit: z.number().int().min(1).max(200),
  offset: z.number().int().nonnegative(),
}).partial().strict()

/** POST /appointments/reasons: the kind is chosen once and cannot be changed. */
export const AppointmentReasonCreateSchema = z.object({
  kind: AppointmentReasonKindSchema,
  name,
  sequence,
}).partial().required({ kind: true, name: true }).strict()

/** PATCH /appointments/reasons/{id}. */
export const AppointmentReasonPatchSchema = z.object({ name, sequence }).partial().strict()

export type AppointmentReasonKind = z.infer<typeof AppointmentReasonKindSchema>
export type AppointmentReason = z.infer<typeof AppointmentReasonSchema>
export type AppointmentReasonList = z.infer<typeof AppointmentReasonListSchema>
export type AppointmentReasonListQuery = z.infer<typeof AppointmentReasonListQuerySchema>
export type AppointmentReasonCreate = z.infer<typeof AppointmentReasonCreateSchema>
export type AppointmentReasonPatch = z.infer<typeof AppointmentReasonPatchSchema>
