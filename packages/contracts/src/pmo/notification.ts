import { z } from 'zod'
import { TaskSchema } from './task'

// A registered kind: snake_case words, optionally dotted by application (`tasks.assigned`, `crm.assigned`).
const NOTIFICATION_KIND_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/

export const TaskNotificationKindSchema = z.enum(['assignment', 'comment', 'mention', 'deadline', 'tasks.assigned'])
export const ProjectNotificationKindSchema = z.enum(['charter_review', 'charter_approved', 'charter_returned'])
export const NotificationKindSchema = z.enum([
  'assignment', 'comment', 'mention', 'deadline', 'overdue_digest',
  'charter_review', 'charter_approved', 'charter_returned',
  'meeting_invite', 'meeting_series_invite', 'meeting_resolution', 'meeting_converted',
  'meeting_changed', 'meeting_cancelled', 'meeting_reminder', 'meeting_resolution_overdue',
  'tasks.assigned',
])

const TaskNotificationBase = {
  id: z.number().int().positive(),
  task_id: z.number().int().positive(),
  task_name: z.string(),
  body: z.string(),
  created_at: z.string(),
  is_read: z.boolean(),
}

export const AssignmentNotificationSchema = z.object({
  kind: z.literal('assignment'),
  ...TaskNotificationBase,
}).strict()

export const CommentNotificationSchema = z.object({
  kind: z.literal('comment'),
  ...TaskNotificationBase,
}).strict()

export const MentionNotificationSchema = z.object({
  kind: z.literal('mention'),
  ...TaskNotificationBase,
}).strict()

export const DeadlineNotificationSchema = z.object({
  kind: z.literal('deadline'),
  ...TaskNotificationBase,
}).strict()

export const AssignedTaskNotificationSchema = z.object({
  id: z.number().int().positive(),
  kind: z.literal('tasks.assigned'),
  task_id: z.number().int().positive(),
  title: z.string(),
  task_name: z.string(),
  created_at: z.string(),
  is_read: z.boolean(),
}).strict()

export const MeetingNotificationSchema = z.object({
  id: z.number().int().positive(),
  kind: z.enum([
    'meeting_invite', 'meeting_series_invite', 'meeting_resolution', 'meeting_converted',
    'meeting_changed', 'meeting_cancelled', 'meeting_reminder', 'meeting_resolution_overdue',
  ]),
  meeting_id: z.number().int().positive(),
  meeting_name: z.string(),
  body: z.string(),
  created_at: z.string(),
  is_read: z.boolean(),
}).strict()

export const ProjectCharterNotificationSchema = z.object({
  id: z.number().int().positive(),
  kind: ProjectNotificationKindSchema,
  project_id: z.number().int().positive(),
  project_name: z.string(),
  body: z.string(),
  created_at: z.string(),
  is_read: z.boolean(),
}).strict()

export const DigestNotificationSchema = z.object({
  id: z.number().int().positive(),
  kind: z.literal('overdue_digest'),
  digest_id: z.number().int().positive(),
  overdue_count: z.number().int().nonnegative(),
  local_date: z.string().nullable(),
  body: z.string(),
  created_at: z.string(),
  is_read: z.boolean(),
}).strict()

export const NotificationSchema = z.discriminatedUnion('kind', [
  AssignmentNotificationSchema,
  CommentNotificationSchema,
  MentionNotificationSchema,
  DeadlineNotificationSchema,
  AssignedTaskNotificationSchema,
  DigestNotificationSchema,
  ProjectCharterNotificationSchema,
  MeetingNotificationSchema,
])

const KNOWN_NOTIFICATION_KINDS: ReadonlySet<string> = new Set(NotificationKindSchema.options)

/**
 * A bell row of a kind this contract does not know: another application registered it in
 * liwan_notify after this build. Only the envelope is read; extra keys are kept. A known kind
 * never parses here, so a malformed known row still fails the list.
 */
export const UnknownNotificationSchema = z.object({
  id: z.number().int().positive(),
  kind: z.string().regex(NOTIFICATION_KIND_PATTERN).refine(
    (kind) => !KNOWN_NOTIFICATION_KINDS.has(kind),
    { message: 'a known notification kind must match its own shape' },
  ),
  title: z.string().nullish(),
  body: z.string().nullish(),
  created_at: z.string(),
  is_read: z.boolean(),
}).loose()

export const BellNotificationSchema = z.union([NotificationSchema, UnknownNotificationSchema])

export const NotificationListSchema = z.object({
  items: z.array(BellNotificationSchema),
  total: z.number().int().nonnegative(),
  unread_count: z.number().int().nonnegative(),
}).strict()

export const NotificationReadResultSchema = z.object({
  updated: z.number().int().nonnegative(),
}).strict()

export const NotificationDigestDetailSchema = z.object({
  id: z.number().int().positive(),
  kind: z.literal('overdue_digest'),
  local_date: z.string().nullable(),
  overdue_count: z.number().int().nonnegative(),
  items: z.array(TaskSchema),
  total: z.number().int().nonnegative(),
}).strict()

export type NotificationKind = z.infer<typeof NotificationKindSchema>
export type Notification = z.infer<typeof NotificationSchema>
export type UnknownNotification = z.infer<typeof UnknownNotificationSchema>
export type BellNotification = z.infer<typeof BellNotificationSchema>
export type NotificationList = z.infer<typeof NotificationListSchema>
export type NotificationReadResult = z.infer<typeof NotificationReadResultSchema>
export type NotificationDigestDetail = z.infer<typeof NotificationDigestDetailSchema>
