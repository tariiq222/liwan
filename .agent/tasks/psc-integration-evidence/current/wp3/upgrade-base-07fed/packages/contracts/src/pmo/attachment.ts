import { z } from 'zod'

export const TaskAttachmentSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  mimetype: z.string().min(1),
  url: z.string().min(1),
}).strict()

export const TaskAttachmentListSchema = z.object({
  items: z.array(TaskAttachmentSchema),
  total: z.number().int().nonnegative(),
}).strict()

export const TaskAttachmentUploadSchema = z.object({
  name: z.string().trim().min(1),
  mimetype: z.string().trim().min(1).optional(),
  data: z.string().min(1),
}).strict()

export type TaskAttachment = z.infer<typeof TaskAttachmentSchema>
export type TaskAttachmentList = z.infer<typeof TaskAttachmentListSchema>
export type TaskAttachmentUpload = z.infer<typeof TaskAttachmentUploadSchema>

