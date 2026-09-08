import { z } from 'zod'
import { CalendarDateSchema } from './schedule'

const DeliverableSchema = z.object({ name: z.string().min(1), done: z.boolean() }).strict()

export const MilestoneSchema = z.object({
  id: z.number().int().positive(), name: z.string(), deadline: CalendarDateSchema.nullable(), is_reached: z.boolean(),
  reached_date: CalendarDateSchema.nullable(), task_count: z.number().int(), done_task_count: z.number().int(),
  start_date: CalendarDateSchema.nullable().default(null),
  deliverables: z.array(DeliverableSchema).default([]),
}).strict()

export const MilestoneBodySchema = z.object({
  name: z.string().min(1), deadline: CalendarDateSchema.nullable().optional(),
  start_date: CalendarDateSchema.nullable().optional(), deliverables: z.array(DeliverableSchema).optional(),
}).strict()

export const MilestonePatchSchema = z.object({
  name: z.string().min(1).optional(), deadline: CalendarDateSchema.nullable().optional(),
  start_date: CalendarDateSchema.nullable().optional(), deliverables: z.array(DeliverableSchema).optional(),
  is_reached: z.boolean().optional(),
}).strict()

export type Milestone = z.infer<typeof MilestoneSchema>
export type MilestonePatch = z.infer<typeof MilestonePatchSchema>
