import { z } from 'zod'

export const AppointmentsRecordSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
}).strict()

export const AppointmentsRecordListSchema = z.object({
  items: z.array(AppointmentsRecordSchema),
  total: z.number().int().nonnegative(),
}).strict()

export type AppointmentsRecord = z.infer<typeof AppointmentsRecordSchema>
export type AppointmentsRecordList = z.infer<typeof AppointmentsRecordListSchema>
