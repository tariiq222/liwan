import { z } from 'zod'

export const ChatUserRefSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
}).strict()

export const ChatConversationTypeSchema = z.enum(['direct', 'group', 'channel'])

export const ChatNotificationSchema = z.enum(['all', 'mentions', 'no_notif'])

export const ChatConversationSchema = z.object({
  id: z.number().int().positive(),
  type: ChatConversationTypeSchema,
  name: z.string(),
  unread_count: z.number().int().nonnegative(),
  last_message_at: z.string().nullable(),
  last_message_preview: z.string().nullable(),
  member_count: z.number().int().nonnegative(),
  muted: z.boolean(),
  notifications: ChatNotificationSchema.nullable(),
  peer_seen_message_id: z.number().int().positive().nullable(),
  im_status: z.string().nullable(),
  can_manage: z.boolean(),
}).strict()

export const ChatConversationListSchema = z.object({
  items: z.array(ChatConversationSchema),
  total: z.number().int().nonnegative(),
}).strict()

export const ChatRecipientListSchema = z.object({
  items: z.array(ChatUserRefSchema),
  total: z.number().int().nonnegative(),
}).strict()

export const ChatMemberSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  im_status: z.string().nullable(),
}).strict()

export const ChatMemberListSchema = z.object({
  items: z.array(ChatMemberSchema),
  total: z.number().int().nonnegative(),
}).strict()

export const ChatConversationCreateSchema = z.object({
  user_ids: z.array(z.number().int().positive()).min(1).optional(),
  name: z.string().optional(),
  type: ChatConversationTypeSchema.optional(),
}).strict()

export const ChatConversationPatchSchema = z.object({
  name: z.string().optional(),
  muted: z.boolean().optional(),
  notifications: ChatNotificationSchema.nullable().optional(),
}).strict()

export const ChatMemberChangeSchema = z.object({
  user_ids: z.array(z.number().int().positive()).min(1),
}).strict()

export type ChatUserRef = z.infer<typeof ChatUserRefSchema>
export type ChatConversationType = z.infer<typeof ChatConversationTypeSchema>
export type ChatNotification = z.infer<typeof ChatNotificationSchema>
export type ChatConversation = z.infer<typeof ChatConversationSchema>
export type ChatConversationList = z.infer<typeof ChatConversationListSchema>
export type ChatRecipientList = z.infer<typeof ChatRecipientListSchema>
export type ChatMember = z.infer<typeof ChatMemberSchema>
export type ChatMemberList = z.infer<typeof ChatMemberListSchema>
export type ChatConversationCreate = z.infer<typeof ChatConversationCreateSchema>
export type ChatConversationPatch = z.infer<typeof ChatConversationPatchSchema>
export type ChatMemberChange = z.infer<typeof ChatMemberChangeSchema>
