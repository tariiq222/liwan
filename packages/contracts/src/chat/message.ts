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

export const ChatMessageSchema = z.object({
  id: z.number().int().positive(),
  conversation_id: z.number().int().positive(),
  author: ChatUserRefSchema,
  body: z.string(),
  created_at: z.string(),
  attachments: z.array(ChatAttachmentSchema),
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
}).strict()

export const ChatReadSchema = z.object({
  message_id: z.number().int().positive(),
}).strict()

export type ChatAttachment = z.infer<typeof ChatAttachmentSchema>
export type ChatAttachmentList = z.infer<typeof ChatAttachmentListSchema>
export type ChatMessage = z.infer<typeof ChatMessageSchema>
export type ChatMessageList = z.infer<typeof ChatMessageListSchema>
export type ChatMessageSend = z.infer<typeof ChatMessageSendSchema>
export type ChatRead = z.infer<typeof ChatReadSchema>
