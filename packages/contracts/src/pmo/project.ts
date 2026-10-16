import { z } from 'zod'
import { ProjectCharterSchema, ProjectCharterStateSchema, ProjectCharterWriteSchema } from './project-charter'
import { CalendarDateSchema } from './schedule'
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
  manager: UserRefSchema.nullable().optional(), date_end: z.string().nullable().optional(),
  allowed_actions: z.array(z.enum(['read', 'write', 'archive'])).optional().default([]),
  charter_state: ProjectCharterStateSchema,
}).strict()

export const ProjectCompletionApprovalSchema = z.enum(['none', 'project_manager', 'specific_user'])

export const ProjectDetailSchema = ProjectSchema.extend({
  stages: z.array(ProjectStageSchema), description_html: z.string(), manager: UserRefSchema.nullable(),
  privacy_visibility: VisibilitySchema, date_start: z.string().nullable(), date_end: z.string().nullable(),
  tags: z.array(TagSchema), followers_count: z.number().int(), milestone_count: z.number().int(),
  allow_task_dependencies: z.boolean().default(false),
  completion_approval: ProjectCompletionApprovalSchema,
  completion_approver: UserRefSchema.nullable(),
  updated_at: z.string().regex(/^v\d+$/),
  charter: ProjectCharterSchema,
}).strict()

export const ProjectListSchema = z.object({ items: z.array(ProjectSchema), total: z.number().int().nonnegative(), can_create: z.boolean(), can_list_archived: z.boolean() }).strict()
// Body of POST /api/v1/projects/{id}/copy: the copy's name and the day its dates are shifted to.
export const ProjectCopyInputSchema = z.object({
  name: z.string().trim().min(1).max(255),
  start_date: CalendarDateSchema,
}).strict()
export const ProjectCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  user_id: z.number().int().positive().nullable().optional(),
  privacy_visibility: VisibilitySchema.optional(),
  allow_task_dependencies: z.boolean().optional(),
  date_start: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
  date_end: z.string().nullable().optional(),
  tag_ids: z.array(z.number().int()).optional(),
  charter: ProjectCharterWriteSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.date !== undefined && value.date_end !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'date and date_end cannot both be provided',
      path: ['date_end'],
    })
  }
})
export const ProjectPatchSchema = z.object({
  name: z.string().min(1).optional(), description: z.string().optional(), user_id: z.number().int().nullable().optional(),
  privacy_visibility: VisibilitySchema.optional(), allow_task_dependencies: z.boolean().optional(), date_start: z.string().nullable().optional(), date: z.string().nullable().optional(),
  tag_ids: z.array(z.number().int()).optional(),
  nasq_completion_approval: ProjectCompletionApprovalSchema.optional(),
  nasq_completion_approver_id: z.number().int().positive().nullable().optional(),
  charter: ProjectCharterWriteSchema.optional(),
  expected_updated_at: z.string().regex(/^v\d+$/).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.charter !== undefined && value.expected_updated_at === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'expected_updated_at is required when charter is present',
      path: ['expected_updated_at'],
    })
  }
})
// Native-only PATCH may omit expected_updated_at. If the token is supplied,
// the server still row-locks and rejects a stale value.
export const ProjectStatusBodySchema = z.object({ status: ProjectStatusSchema }).strict()
export const StageBodySchema = z.object({ name: z.string().min(1), fold: z.boolean().optional() }).strict()
export const StagePatchSchema = z.object({ name: z.string().min(1).optional(), fold: z.boolean().optional() }).strict()
export const StageOrderBodySchema = z.object({ ids: z.array(z.number().int().positive()) }).strict()

export type ProjectCompletionApproval = z.infer<typeof ProjectCompletionApprovalSchema>
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>
export type Visibility = z.infer<typeof VisibilitySchema>
export type UserRef = z.infer<typeof UserRefSchema>
export type Project = z.infer<typeof ProjectSchema>
export type ProjectStage = z.infer<typeof ProjectStageSchema>
export type ProjectDetail = z.infer<typeof ProjectDetailSchema>
export type ProjectList = z.infer<typeof ProjectListSchema>
export type ProjectPatch = z.infer<typeof ProjectPatchSchema>
export type ProjectCreate = z.infer<typeof ProjectCreateSchema>
export type ProjectCopyInput = z.infer<typeof ProjectCopyInputSchema>
