import { z } from 'zod'

export const MilestoneSchema = z.object({
  id: z.number().int().positive(), name: z.string(), deadline: z.string().nullable(), is_reached: z.boolean(),
  reached_date: z.string().nullable(), task_count: z.number().int(), done_task_count: z.number().int(),
}).strict()

export const MilestoneBodySchema = z.object({ name: z.string().min(1), deadline: z.string().nullable().optional() }).strict()

export const MilestonePatchSchema = z.object({ name: z.string().min(1).optional(), deadline: z.string().nullable().optional(), is_reached: z.boolean().optional() }).strict()

export type Milestone = z.infer<typeof MilestoneSchema>
export type MilestonePatch = z.infer<typeof MilestonePatchSchema>
