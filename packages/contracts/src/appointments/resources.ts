import { z } from 'zod'

const name = z.string().trim().min(1).max(255)
const id = z.number().int().positive()

export const AppointmentResourceKindSchema = z.enum(['user', 'material'])

/** One bookable resource: an employee (`user`, owned by HR, read only here) or a room or device (`material`). */
export const AppointmentResourceSchema = z.object({
  id,
  name: z.string(),
  type: AppointmentResourceKindSchema,
  calendar_id: id.nullable(),
  active: z.boolean(),
}).strict()

export const AppointmentResourceListSchema = z.object({
  items: z.array(AppointmentResourceSchema),
  total: z.number().int().nonnegative(),
}).strict()

/** POST /appointments/resources: always creates a `material` resource of the current company. */
export const AppointmentResourceCreateSchema = z.object({
  name,
  calendar_id: id,
}).partial().required({ name: true }).strict()

/** PATCH /appointments/resources/{id}: a `material` resource only; an employee resource answers 403. */
export const AppointmentResourcePatchSchema = AppointmentResourceCreateSchema.partial().strict()

export type AppointmentResource = z.infer<typeof AppointmentResourceSchema>
export type AppointmentResourceList = z.infer<typeof AppointmentResourceListSchema>
export type AppointmentResourceCreate = z.infer<typeof AppointmentResourceCreateSchema>
export type AppointmentResourcePatch = z.infer<typeof AppointmentResourcePatchSchema>
