import { z } from 'zod'
import { ChatUserRefSchema } from './conversation'

export const ChatAttachmentSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  mimetype: z.string(),
  url: z.string(),
}).strict()

export const ChatAttachmentListSchema = z.object({
  items: z.array(ChatAttachmentSchema),
  total: z.number().int().nonnegative(),
}).strict()

export const ChatMessageParentSchema = z.object({
  id: z.number().int().positive(),
  author: ChatUserRefSchema,
  body: z.string(),
}).strict()

export const ChatMessageReactionSchema = z.object({
  content: z.string(),
  count: z.number().int().nonnegative(),
  me: z.boolean(),
}).strict()

export const ChatMessageSchema = z.object({
  id: z.number().int().positive(),
  conversation_id: z.number().int().positive(),
  author: ChatUserRefSchema,
  body: z.string(),
  created_at: z.string(),
  attachments: z.array(ChatAttachmentSchema),
  parent: ChatMessageParentSchema.nullable(),
  edited: z.boolean(),
  pinned: z.boolean(),
  starred: z.boolean(),
  reactions: z.array(ChatMessageReactionSchema),
}).strict()

export const ChatMessageListSchema = z.object({
  items: z.array(ChatMessageSchema),
  total: z.number().int().nonnegative(),
}).strict()

export const ChatMessageSendSchema = z.object({
  body: z.string().optional(),
  attachment: z.object({
    name: z.string(),
    mimetype: z.string().optional(),
    data: z.string(),
  }).strict().optional(),
  parent_id: z.number().int().positive().optional(),
  mention_user_ids: z.array(z.number().int().positive()).optional(),
}).strict()

export const ChatMessageUpdateSchema = z.object({
  body: z.string(),
}).strict()

export const ChatReactionActionSchema = z.enum(['add', 'remove'])

export const ChatMessageReactionWriteSchema = z.object({
  content: z.string(),
  action: ChatReactionActionSchema,
}).strict()

export const ChatMessagePinSchema = z.object({
  pinned: z.boolean(),
}).strict()

export const ChatTypingSchema = z.object({
  is_typing: z.boolean(),
}).strict()

export const ChatReadSchema = z.object({
  message_id: z.number().int().positive(),
}).strict()

export type ChatAttachment = z.infer<typeof ChatAttachmentSchema>
export type ChatAttachmentList = z.infer<typeof ChatAttachmentListSchema>
export type ChatMessage = z.infer<typeof ChatMessageSchema>
export type ChatMessageParent = z.infer<typeof ChatMessageParentSchema>
export type ChatMessageReaction = z.infer<typeof ChatMessageReactionSchema>
export type ChatMessageList = z.infer<typeof ChatMessageListSchema>
export type ChatMessageSend = z.infer<typeof ChatMessageSendSchema>
export type ChatMessageUpdate = z.infer<typeof ChatMessageUpdateSchema>
export type ChatMessageReactionWrite = z.infer<typeof ChatMessageReactionWriteSchema>
export type ChatMessagePin = z.infer<typeof ChatMessagePinSchema>
export type ChatTyping = z.infer<typeof ChatTypingSchema>
export type ChatRead = z.infer<typeof ChatReadSchema>
