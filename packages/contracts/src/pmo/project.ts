import { z } from 'zod'

export const ProjectRefSchema = z.object({ id: z.number().int(), name: z.string() }).strict()

// The five statuses a manager may set. Odoo's 'to_define' ("unset") is null on
// the wire and never a member of this enum.
export const ProjectStatusSchema = z.enum(['on_track', 'at_risk', 'off_track', 'on_hold', 'done'])
export const PROJECT_STATUSES = ProjectStatusSchema.options

export const ProjectSchema = z.object({
  id: z.number().int().positive(), name: z.string(), status: ProjectStatusSchema.nullable(),
  progress: z.number().int().min(0).max(100), task_count: z.number().int(), closed_task_count: z.number().int(),
}).strict()

export const ProjectStageSchema = z.object({ id: z.number().int().positive(), name: z.string(), sequence: z.number().int(), fold: z.boolean() }).strict()

export const ProjectDetailSchema = ProjectSchema.extend({ stages: z.array(ProjectStageSchema), can_manage: z.boolean() }).strict()

export const ProjectStatusBodySchema = z.object({ status: ProjectStatusSchema }).strict()

export type ProjectStatus = z.infer<typeof ProjectStatusSchema>
export type Project = z.infer<typeof ProjectSchema>
export type ProjectStage = z.infer<typeof ProjectStageSchema>
export type ProjectDetail = z.infer<typeof ProjectDetailSchema>
