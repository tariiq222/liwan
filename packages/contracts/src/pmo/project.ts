import { z } from 'zod'
import { ChangeControlModeSchema } from './change'
import { ProjectCharterSchema, ProjectCharterStateSchema, ProjectCharterWriteSchema } from './project-charter'
import { ProjectToolPreferencesPatchSchema, ProjectToolsStateSchema } from './project-tools'
import { CalendarDateSchema } from './schedule'
import { TagSchema } from './task'

export const ProjectRefSchema = z.object({ id: z.number().int(), name: z.string() }).strict()
export const UserRefSchema = z.object({ id: z.number().int().positive(), name: z.string() }).strict()

export const ProjectObjectiveWriteSchema = z.object({
  goal: z.string().trim().min(1),
  metric: z.string().optional(),
  target: z.string().optional(),
}).strict()
export const ProjectObjectiveSchema = z.object({
  id: z.number().int().positive(),
  goal: z.string().trim().min(1),
  metric: z.string(),
  target: z.string(),
}).strict()

export const ProjectStatusSchema = z.enum(['on_track', 'at_risk', 'off_track', 'on_hold', 'done'])
export const PROJECT_STATUSES = ProjectStatusSchema.options
export const VisibilitySchema = z.enum(['employees', 'followers'])

export const ProjectStageSchema = z.object({
  id: z.number().int().positive(), name: z.string(), sequence: z.number().int(), fold: z.boolean(), task_count: z.number().int(),
}).strict()

export const ProjectPhaseSchema = z.enum(['initiating', 'planning', 'executing', 'closing', 'closed'])
export const PROJECT_PHASES = ProjectPhaseSchema.options
// `warning` marks a check that does not block the move: an unmet one needs `acknowledge_warnings` on the move.
export const ProjectPhaseGateCheckSchema = z.object({ key: z.string(), ok: z.boolean(), warning: z.boolean().optional() }).strict()
export const ProjectPhaseStateSchema = z.object({
  current: ProjectPhaseSchema, next: ProjectPhaseSchema.nullable(), previous: ProjectPhaseSchema.nullable(),
  next_checks: z.array(ProjectPhaseGateCheckSchema),
}).strict()
// Body of POST /api/v1/projects/{id}/phase.
export const ProjectPhaseMoveSchema = z.object({
  phase: ProjectPhaseSchema, expected_updated_at: z.string().regex(/^v\d+$/), acknowledge_warnings: z.boolean().optional(),
}).strict()

export const ProjectSchema = z.object({
  id: z.number().int().positive(), name: z.string(), status: ProjectStatusSchema.nullable(),
  progress: z.number().int().min(0).max(100), task_count: z.number().int(), closed_task_count: z.number().int(),
  active: z.boolean(), can_manage: z.boolean(),
  manager: UserRefSchema.nullable().optional(), date_end: z.string().nullable().optional(),
  allowed_actions: z.array(z.enum(['read', 'write', 'archive'])).optional().default([]),
  charter_state: ProjectCharterStateSchema.nullable(),
  phase: ProjectPhaseSchema.nullable(),
}).strict()

export const ProjectCompletionApprovalSchema = z.enum(['none', 'project_manager', 'specific_user'])

export const ProjectDetailSchema = ProjectSchema.extend({
  stages: z.array(ProjectStageSchema), description_html: z.string(), manager: UserRefSchema.nullable(),
  privacy_visibility: VisibilitySchema, date_start: z.string().nullable(), date_end: z.string().nullable(),
  tags: z.array(TagSchema), followers_count: z.number().int(), milestone_count: z.number().int().nullable(),
  allow_task_dependencies: z.boolean().default(false),
  completion_approval: ProjectCompletionApprovalSchema,
  completion_approver: UserRefSchema.nullable(),
  updated_at: z.string().regex(/^v\d+$/),
  tools: ProjectToolsStateSchema,
  objectives: z.array(ProjectObjectiveSchema),
  success_criteria: z.string(),
  charter: ProjectCharterSchema.nullable(),
  phase_state: ProjectPhaseStateSchema.nullable(),
  change_control_mode: ChangeControlModeSchema,
}).strict()

export const ProjectListSchema = z.object({ items: z.array(ProjectSchema), total: z.number().int().nonnegative(), can_create: z.boolean(), can_list_archived: z.boolean() }).strict()
// Body of POST /api/v1/projects/{id}/copy: the copy's name and the day its dates are shifted to.
export const ProjectCopyInputSchema = z.object({
  name: z.string().trim().min(1).max(255),
  start_date: CalendarDateSchema,
  // Required by the server when the source has no end date and the company requires one.
  end_date: CalendarDateSchema.optional(),
}).strict()
export const ProjectCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  objectives: z.array(ProjectObjectiveWriteSchema).optional(),
  success_criteria: z.string().optional(),
  user_id: z.number().int().positive().nullable().optional(),
  privacy_visibility: VisibilitySchema.optional(),
  allow_task_dependencies: z.boolean().optional(),
  date_start: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
  date_end: z.string().nullable().optional(),
  tag_ids: z.array(z.number().int()).optional(),
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
  privacy_visibility: VisibilitySchema.optional(), allow_task_dependencies: z.boolean().optional(), date_start: z.string().nullable().optional(), date: z.string().nullable().optional(), date_end: z.string().nullable().optional(),
  tag_ids: z.array(z.number().int()).optional(),
  objectives: z.array(ProjectObjectiveWriteSchema).optional(),
  success_criteria: z.string().optional(),
  tool_preferences: ProjectToolPreferencesPatchSchema.optional(),
  liwan_completion_approval: ProjectCompletionApprovalSchema.optional(),
  liwan_completion_approver_id: z.number().int().positive().nullable().optional(),
  charter: ProjectCharterWriteSchema.optional(),
  expected_updated_at: z.string().regex(/^v\d+$/).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.date !== undefined && value.date_end !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'date and date_end cannot both be provided', path: ['date_end'] })
  }
  if ((value.charter !== undefined || value.objectives !== undefined || value.success_criteria !== undefined || value.tool_preferences !== undefined) && value.expected_updated_at === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'expected_updated_at is required when charter, objectives, success_criteria or tool_preferences is present',
      path: ['expected_updated_at'],
    })
  }
})
// Other core PATCH fields may omit expected_updated_at. If the token is supplied,
// the server still row-locks and rejects a stale value.
export const ProjectStatusBodySchema = z.object({ status: ProjectStatusSchema }).strict()
export const StageOrderBodySchema = z.object({ ids: z.array(z.number().int().positive()) }).strict()

export type ProjectCompletionApproval = z.infer<typeof ProjectCompletionApprovalSchema>
export type ProjectPhase = z.infer<typeof ProjectPhaseSchema>
export type ProjectPhaseGateCheck = z.infer<typeof ProjectPhaseGateCheckSchema>
export type ProjectPhaseState = z.infer<typeof ProjectPhaseStateSchema>
export type ProjectPhaseMove = z.infer<typeof ProjectPhaseMoveSchema>
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

export type ProjectObjective = z.infer<typeof ProjectObjectiveSchema>
export type ProjectObjectiveWrite = z.infer<typeof ProjectObjectiveWriteSchema>
