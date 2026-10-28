import { z } from 'zod'

const id = z.number().int().positive()

/** A set of resources that must all be free to book, optionally on a forced calendar. */
export const AppointmentCombinationSchema = z.object({
  id,
  name: z.string(),
  resource_ids: z.array(id).min(1),
  forced_calendar_id: id.nullable(),
  active: z.boolean(),
}).strict()

export const AppointmentCombinationListSchema = z.object({
  items: z.array(AppointmentCombinationSchema),
  total: z.number().int().nonnegative(),
}).strict()

/** POST /appointments/combinations: `resource_ids` is required and may not repeat an id. */
export const AppointmentCombinationCreateSchema = z.object({
  resource_ids: z.array(id).min(1),
  forced_calendar_id: id.nullable(),
}).partial().required({ resource_ids: true }).strict()

/** PATCH /appointments/combinations/{id}: `forced_calendar_id: null` clears the forced calendar. */
export const AppointmentCombinationPatchSchema = AppointmentCombinationCreateSchema.partial().strict()

export type AppointmentCombination = z.infer<typeof AppointmentCombinationSchema>
export type AppointmentCombinationList = z.infer<typeof AppointmentCombinationListSchema>
export type AppointmentCombinationCreate = z.infer<typeof AppointmentCombinationCreateSchema>
export type AppointmentCombinationPatch = z.infer<typeof AppointmentCombinationPatchSchema>
