import { z } from 'zod'

export const HrLeaveBellKindSchema = z.enum(['hr.leave_approved', 'hr.leave_refused'])

/** A leave-decision bell row as the notification list sends it; `title` is the leave's date range, never prose. */
export const HrLeaveBellRowSchema = z.looseObject({
  id: z.number().int().positive(),
  kind: HrLeaveBellKindSchema,
  leave_id: z.number().int().positive(),
  title: z.string(),
  created_at: z.string(),
  is_read: z.boolean(),
})

export type HrLeaveBellKind = z.infer<typeof HrLeaveBellKindSchema>
export type HrLeaveBellRow = z.infer<typeof HrLeaveBellRowSchema>
