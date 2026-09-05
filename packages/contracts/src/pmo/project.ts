import { z } from 'zod'
import { TagSchema } from './task'

export const ProjectRefSchema = z.object({ id: z.number().int(), name: z.string() }).strict()
export const UserRefSchema = z.object({ id: z.number().int().positive(), name: z.string() }).strict()

export const ProjectStatusSchema = z.enum(['on_track', 'at_risk', 'off_track', 'on_hold', 'done'])
export const PROJECT_STATUSES = ProjectStatusSchema.options
export const VisibilitySchema = z.enum(['employees', 'followers'])

export const ProjectStageSchema = z.object({
  id: z.number().int().positive(), name: z.string(), sequence: z.number().int(), fold: z.boolean(), task_count: z.number().int(),
}).strict()

export const ProjectSchema = z.object({
  id: z.number().int().positive(), name: z.string(), status: ProjectStatusSchema.nullable(),
  progress: z.number().int().min(0).max(100), task_count: z.number().int(), closed_task_count: z.number().int(),
  active: z.boolean(), can_manage: z.boolean(),
}).strict()

export const ProjectDetailSchema = ProjectSchema.extend({
  stages: z.array(ProjectStageSchema), description_html: z.string(), manager: UserRefSchema.nullable(),
  privacy_visibility: VisibilitySchema, date_start: z.string().nullable(), date_end: z.string().nullable(),
  tags: z.array(TagSchema), followers_count: z.number().int(), milestone_count: z.number().int(),
}).strict()

export const ProjectListSchema = z.object({ items: z.array(ProjectSchema), can_create: z.boolean() }).strict()
export const ProjectCreateSchema = z.object({ name: z.string().min(1) }).strict()
export const ProjectPatchSchema = z.object({
  name: z.string().min(1).optional(), description: z.string().optional(), user_id: z.number().int().nullable().optional(),
  privacy_visibility: VisibilitySchema.optional(), date_start: z.string().nullable().optional(), date: z.string().nullable().optional(),
  tag_ids: z.array(z.number().int()).optional(),
}).strict()
export const ProjectStatusBodySchema = z.object({ status: ProjectStatusSchema }).strict()
export const StageBodySchema = z.object({ name: z.string().min(1), fold: z.boolean().optional() }).strict()
export const StagePatchSchema = z.object({ name: z.string().min(1).optional(), fold: z.boolean().optional() }).strict()
export const StageOrderBodySchema = z.object({ ids: z.array(z.number().int().positive()) }).strict()

export type ProjectStatus = z.infer<typeof ProjectStatusSchema>
export type Visibility = z.infer<typeof VisibilitySchema>
export type UserRef = z.infer<typeof UserRefSchema>
export type Project = z.infer<typeof ProjectSchema>
export type ProjectStage = z.infer<typeof ProjectStageSchema>
export type ProjectDetail = z.infer<typeof ProjectDetailSchema>
export type ProjectList = z.infer<typeof ProjectListSchema>
export type ProjectPatch = z.infer<typeof ProjectPatchSchema>
