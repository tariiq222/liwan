import { z } from 'zod'
import { TaskSchema } from './task'

export const TaskNotificationKindSchema = z.enum(['assignment', 'comment', 'deadline'])
export const NotificationKindSchema = z.enum([
  'assignment', 'comment', 'deadline', 'overdue_digest',
  'meeting_invite', 'meeting_resolution', 'meeting_converted',
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

export const DeadlineNotificationSchema = z.object({
  kind: z.literal('deadline'),
  ...TaskNotificationBase,
}).strict()

export const MeetingNotificationSchema = z.object({
  id: z.number().int().positive(),
  kind: z.enum(['meeting_invite', 'meeting_resolution', 'meeting_converted']),
  meeting_id: z.number().int().positive(),
  meeting_name: z.string(),
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
  DeadlineNotificationSchema,
  DigestNotificationSchema,
  MeetingNotificationSchema,
])

export const NotificationListSchema = z.object({
  items: z.array(NotificationSchema),
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
export type NotificationList = z.infer<typeof NotificationListSchema>
export type NotificationReadResult = z.infer<typeof NotificationReadResultSchema>
export type NotificationDigestDetail = z.infer<typeof NotificationDigestDetailSchema>
