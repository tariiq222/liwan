import { z } from 'zod'
import { PersonRefSchema } from '../common/person'

export const PersonalTaskStateSchema = z.enum(['open', 'done', 'cancelled'])
export const PersonalTaskPrioritySchema = z.enum(['normal', 'high'])

// Odoo's iso(): UTC, second precision, always a trailing Z.
const UtcDateTimeSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)

const TaskRefSchema = z.object({ id: z.number().int().positive(), name: z.string() }).strict()

export const PersonalTaskActionsSchema = z.object({
  write: z.boolean(),
  done: z.boolean(),
  reopen: z.boolean(),
  cancel: z.boolean(),
  convert: z.boolean(),
  // Archive withdraws a done or cancelled task from the lists; unarchive restores it. Never a delete.
  archive: z.boolean(),
  unarchive: z.boolean(),
}).strict()

// Detail shape: returned by every personal task read and write.
export const PersonalTaskSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  description: z.string(),
  state: PersonalTaskStateSchema,
  priority: PersonalTaskPrioritySchema,
  date_deadline: UtcDateTimeSchema.nullable(),
  assignees: z.array(PersonRefSchema),
  creator: PersonRefSchema,
  parent: TaskRefSchema.nullable(),
  // True for every sub-task, also when its parent is not readable by the caller (then `parent` is null).
  is_subtask: z.boolean(),
  subtasks: z.array(TaskRefSchema.extend({ state: PersonalTaskStateSchema }).strict()),
  attachment_count: z.number().int().nonnegative(),
  created_at: UtcDateTimeSchema,
  updated_at: UtcDateTimeSchema,
  allowed_actions: PersonalTaskActionsSchema,
}).strict()

// Unified list row: `href` is supplied by the server, the web never builds a project URL.
export const MyTaskListItemSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  state: PersonalTaskStateSchema,
  priority: PersonalTaskPrioritySchema,
  date_deadline: UtcDateTimeSchema.nullable(),
  assignees: z.array(PersonRefSchema),
  source: z.enum(['personal', 'project']),
  project: TaskRefSchema.nullable(),
  href: z.string().min(1),
}).strict().superRefine((row, ctx) => {
  if ((row.source === 'project') !== (row.project !== null)) {
    ctx.addIssue({ code: 'custom', path: ['project'], message: 'project is set exactly on project rows' })
  }
})

export const MyTaskListPageSchema = z.object({
  items: z.array(MyTaskListItemSchema),
  total: z.number().int().nonnegative(),
}).strict()

// GET /api/v1/my-tasks/summary: counts over the tasks the list's scope and search select.
export const MyTaskSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  open: z.number().int().nonnegative(),
  overdue: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
}).strict()

export const PersonalTaskCommentSchema = z.object({
  id: z.number().int().positive(),
  body: z.string(),
  author: PersonRefSchema.nullable(),
  created_at: UtcDateTimeSchema,
}).strict()

export const PersonalTaskAttachmentSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  mimetype: z.string(),
  url: z.string(),
}).strict()

// The standard collection envelope of every my-tasks collection endpoint.
export const MyTaskCollectionSchema = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), total: z.number().int().nonnegative() }).strict()

export const ConvertTargetSchema = TaskRefSchema
export const ConvertResultSchema = z.object({ href: z.string().min(1) }).strict()

export type PersonalTaskState = z.infer<typeof PersonalTaskStateSchema>
export type PersonalTaskActions = z.infer<typeof PersonalTaskActionsSchema>
export type PersonalTask = z.infer<typeof PersonalTaskSchema>
export type MyTaskListItem = z.infer<typeof MyTaskListItemSchema>
export type MyTaskListPage = z.infer<typeof MyTaskListPageSchema>
export type MyTaskSummary = z.infer<typeof MyTaskSummarySchema>
export type PersonalTaskComment = z.infer<typeof PersonalTaskCommentSchema>
export type PersonalTaskAttachment = z.infer<typeof PersonalTaskAttachmentSchema>
export type ConvertTarget = z.infer<typeof ConvertTargetSchema>
export type ConvertResult = z.infer<typeof ConvertResultSchema>
