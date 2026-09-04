import { z } from 'zod'
import { TaskStateSchema } from './state'

export const RefSchema = z.object({ id: z.number().int().positive(), name: z.string() }).strict()
export const TagSchema = z.object({ id: z.number().int().positive(), name: z.string(), color: z.number().int() }).strict()

export const TaskSchema = z.object({
  id: z.number().int().positive(), name: z.string(), project: RefSchema.nullable(), state: TaskStateSchema,
  // Phase 1 rules add priority values '2' and '3' on top of the design spec's '0'/'1' —
  // see odoo-addons/nasq_api/serializers/task.py::parse_task_vals, which accepts '0'..'3'.
  priority: z.enum(['0', '1', '2', '3']), date_deadline: z.string().nullable(), days_remaining: z.number().int().nullable(),
  is_overdue: z.boolean(), is_closed: z.boolean(), personal_stage: RefSchema.nullable(),
  assignees: z.array(RefSchema), tags: z.array(TagSchema),
}).strict()

export const TaskDetailSchema = TaskSchema.extend({
  description_html: z.string(), allocated_hours: z.number(), age_days: z.number().int(), cycle_days: z.number().int().nullable(),
  subtasks: z.array(TaskSchema),
  depends_on: z.array(z.object({ id: z.number().int().positive(), name: z.string(), state: TaskStateSchema }).strict()),
  attachments: z.array(z.object({ id: z.number().int().positive(), name: z.string(), mimetype: z.string(), url: z.string() }).strict()),
  can_approve: z.boolean(), created_at: z.string(), updated_at: z.string(),
}).strict()

export const TaskListSchema = z.object({ items: z.array(TaskSchema), total: z.number().int() }).strict()

export const TaskPatchSchema = z.object({
  name: z.string().min(1).optional(), description: z.string().optional(), date_deadline: z.string().nullable().optional(),
  priority: z.enum(['0', '1', '2', '3']).optional(), user_ids: z.array(z.number().int()).optional(), tag_ids: z.array(z.number().int()).optional(),
  personal_stage_type_id: z.number().int().nullable().optional(), allocated_hours: z.number().optional(),
}).strict()

export const TaskCreateSchema = z.object({ name: z.string().min(1), project_id: z.number().int(), parent_id: z.number().int().optional() }).strict()

export const ApiErrorSchema = z.object({ code: z.string(), message: z.string(), field: z.string().optional() }).strict()

export type Task = z.infer<typeof TaskSchema>
export type TaskDetail = z.infer<typeof TaskDetailSchema>
export type TaskPatch = z.infer<typeof TaskPatchSchema>
export type TaskCreate = z.infer<typeof TaskCreateSchema>
