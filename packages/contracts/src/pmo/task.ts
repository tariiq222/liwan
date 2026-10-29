import { z } from 'zod'
import { TaskStateSchema } from './state'
import { CalendarDateSchema } from './schedule'

export const RefSchema = z.object({ id: z.number().int().positive(), name: z.string() }).strict()
export const TagSchema = z.object({ id: z.number().int().positive(), name: z.string(), color: z.number().int() }).strict()
const TaskDeliverableSchema = z.object({ name: z.string().trim().min(1), done: z.boolean() }).strict()

export const TaskSchema = z.object({
  id: z.number().int().positive(), name: z.string(), description_excerpt: z.string().max(140),
  project: RefSchema.nullable(), state: TaskStateSchema,
  // Priorities match the '0'..'3' values accepted by
  // odoo-addons/webvue_pmo/serializers/task.py::parse_task_vals.
  priority: z.enum(['0', '1', '2', '3']), date_deadline: z.string().nullable(), days_remaining: z.number().int().nullable(),
  is_overdue: z.boolean(), is_closed: z.boolean(), personal_stage: RefSchema.nullable(), stage: RefSchema.nullable(),
  assignees: z.array(RefSchema), tags: z.array(TagSchema),
  can_write: z.boolean().optional().default(false),
  can_approve: z.boolean().optional().default(false),
  allowed_transitions: z.array(TaskStateSchema),
  // Subtasks the caller can read (done = state done, never cancelled) and the direct files of the task.
  subtask_count: z.number().int().nonnegative(),
  subtask_done_count: z.number().int().nonnegative(),
  attachment_count: z.number().int().nonnegative(),
}).strict()

export const TaskDetailSchema = TaskSchema.extend({
  description_html: z.string(), allocated_hours: z.number(), age_days: z.number().int(), cycle_days: z.number().int().nullable(),
  subtasks: z.array(TaskSchema),
  depends_on: z.array(z.object({ id: z.number().int().positive(), name: z.string(), state: TaskStateSchema }).strict()),
  attachments: z.array(z.object({ id: z.number().int().positive(), name: z.string(), mimetype: z.string(), url: z.string(), size: z.number().int().nonnegative() }).strict()),
  can_manage_dependencies: z.boolean().default(false), milestone: RefSchema.nullable(), created_at: z.string(), updated_at: z.string(),
  planned_start: CalendarDateSchema.nullable().default(null), deliverables: z.array(TaskDeliverableSchema).default([]),
  allowed_actions: z.array(z.enum([
    'read', 'write', 'archive', 'approve', 'request_completion', 'accept_completion', 'return_completion', 'withdraw_completion',
  ])).optional().default([]),
  completion_pending: z.boolean(),
  completion_revision: z.number().int().nonnegative(),
  completion_return_note: z.string().nullable(),
  completion_policy: z.enum(['none', 'project_manager', 'specific_user']),
  completion_approver: RefSchema.nullable(),
  completion_blocked_reason: z.enum(['no_reviewer', 'reviewer_ineligible']).nullable(),
}).strict()

export const DependencySchema = z.object({ id: z.number().int().positive(), name: z.string(), state: TaskStateSchema }).strict()
export const DependencyListSchema = z.object({ items: z.array(DependencySchema), total: z.number().int(), can_manage: z.boolean(), enabled: z.boolean() }).strict()
export const DependencyCandidateListSchema = z.object({ items: z.array(DependencySchema), total: z.number().int() }).strict()

// GET /api/v1/tasks/summary: counts for the tasks that match the list filters.
export const TaskSummarySchema = z.object({
  total: z.number().int().nonnegative(), open: z.number().int().nonnegative(),
  overdue: z.number().int().nonnegative(), done: z.number().int().nonnegative(),
}).strict()

export const TaskListSchema = z.object({ items: z.array(TaskSchema), total: z.number().int() }).strict()

export const TaskPatchSchema = z.object({
  name: z.string().min(1).optional(), description: z.string().optional(), date_deadline: z.string().nullable().optional(),
  priority: z.enum(['0', '1', '2', '3']).optional(), user_ids: z.array(z.number().int()).optional(), tag_ids: z.array(z.number().int()).optional(),
  personal_stage_type_id: z.number().int().nullable().optional(), allocated_hours: z.number().optional(), stage_id: z.number().int().optional(),
  milestone_id: z.number().int().nullable().optional(), deliverables: z.array(TaskDeliverableSchema).optional(),
}).strict()

export const TaskCreateSchema = z.object({
  name: z.string().min(1), project_id: z.number().int(), parent_id: z.number().int().optional(),
  milestone_id: z.number().int().positive().optional(), planned_start: CalendarDateSchema.optional(),
  date_deadline: z.string().nullable().optional(), description: z.string().optional(),
  deliverables: z.array(TaskDeliverableSchema).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.planned_start && !value.date_deadline) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['date_deadline'], message: 'date_deadline is required with planned_start' })
  }
})

export type Task = z.infer<typeof TaskSchema>
export type TaskSummary = z.infer<typeof TaskSummarySchema>
export type TaskDetail = z.infer<typeof TaskDetailSchema>
export type TaskPatch = z.infer<typeof TaskPatchSchema>
export type TaskCreate = z.infer<typeof TaskCreateSchema>
