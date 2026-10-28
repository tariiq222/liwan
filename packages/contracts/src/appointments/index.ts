import { z } from 'zod'

export const AppointmentTypeSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  duration_minutes: z.number().int().positive(),
}).strict()

export const AppointmentTypeListSchema = z.object({
  items: z.array(AppointmentTypeSchema),
  total: z.number().int().nonnegative(),
}).strict()

export type AppointmentType = z.infer<typeof AppointmentTypeSchema>
export type AppointmentTypeList = z.infer<typeof AppointmentTypeListSchema>
