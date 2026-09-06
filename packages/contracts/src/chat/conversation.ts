import { z } from 'zod'

export const ChatUserRefSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
}).strict()

export const ChatConversationTypeSchema = z.enum(['direct', 'group'])

export const ChatConversationSchema = z.object({
  id: z.number().int().positive(),
  type: ChatConversationTypeSchema,
  name: z.string(),
  unread_count: z.number().int().nonnegative(),
  last_message_at: z.string().nullable(),
  last_message_preview: z.string().nullable(),
  member_count: z.number().int().nonnegative(),
}).strict()

export const ChatConversationListSchema = z.object({
  items: z.array(ChatConversationSchema),
  total: z.number().int().nonnegative(),
}).strict()

export const ChatRecipientListSchema = z.object({
  items: z.array(ChatUserRefSchema),
  total: z.number().int().nonnegative(),
}).strict()

export const ChatMemberListSchema = z.object({
  items: z.array(ChatUserRefSchema),
  total: z.number().int().nonnegative(),
}).strict()

export const ChatConversationCreateSchema = z.object({
  user_ids: z.array(z.number().int().positive()).min(1),
  name: z.string().optional(),
}).strict()

export type ChatUserRef = z.infer<typeof ChatUserRefSchema>
export type ChatConversationType = z.infer<typeof ChatConversationTypeSchema>
export type ChatConversation = z.infer<typeof ChatConversationSchema>
export type ChatConversationList = z.infer<typeof ChatConversationListSchema>
export type ChatRecipientList = z.infer<typeof ChatRecipientListSchema>
export type ChatMemberList = z.infer<typeof ChatMemberListSchema>
export type ChatConversationCreate = z.infer<typeof ChatConversationCreateSchema>
