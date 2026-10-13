import { z } from 'zod'

export const TasksRecordSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
}).strict()

export const TasksRecordListSchema = z.object({
  items: z.array(TasksRecordSchema),
  total: z.number().int().nonnegative(),
}).strict()

export type TasksRecord = z.infer<typeof TasksRecordSchema>
export type TasksRecordList = z.infer<typeof TasksRecordListSchema>
