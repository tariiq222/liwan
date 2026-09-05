import { z } from 'zod'

export const NotificationKindSchema = z.enum(['assignment', 'comment', 'deadline'])

export const NotificationSchema = z.object({
  id: z.number().int().positive(),
  kind: NotificationKindSchema,
  task_id: z.number().int().positive(),
  task_name: z.string(),
  body: z.string(),
  created_at: z.string(),
  is_read: z.boolean(),
}).strict()

export const NotificationListSchema = z.object({
  items: z.array(NotificationSchema),
  total: z.number().int().nonnegative(),
  unread_count: z.number().int().nonnegative(),
}).strict()

export const NotificationReadResultSchema = z.object({
  updated: z.number().int().nonnegative(),
}).strict()

export type NotificationKind = z.infer<typeof NotificationKindSchema>
export type Notification = z.infer<typeof NotificationSchema>
export type NotificationList = z.infer<typeof NotificationListSchema>
export type NotificationReadResult = z.infer<typeof NotificationReadResultSchema>

