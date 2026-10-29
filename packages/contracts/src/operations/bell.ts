import { z } from 'zod'

export const OperationBellKindSchema = z.enum([
  'operations.review_requested',
  'operations.approved',
  'operations.rejected',
  'operations.returned',
])

/** An operations bell row as the notification list sends it; `title` is the request's name, never prose. */
export const OperationBellRowSchema = z.looseObject({
  id: z.number().int().positive(),
  kind: OperationBellKindSchema,
  request_id: z.number().int().positive(),
  title: z.string(),
  created_at: z.string(),
  is_read: z.boolean(),
})

export type OperationBellKind = z.infer<typeof OperationBellKindSchema>
export type OperationBellRow = z.infer<typeof OperationBellRowSchema>
