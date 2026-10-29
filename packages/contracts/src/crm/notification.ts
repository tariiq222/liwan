import { z } from 'zod'
import { CrmTermSchema } from './settings'

export const CrmBellKindSchema = z.enum(['crm.assigned', 'crm.followup_due', 'crm.needs_manager'])

/**
 * A CRM bell row as the notification list sends it. `title` is the opportunity's name and nothing else: the sentence is
 * worded by the UI from `kind`, `count` (how many opportunities an assignment bell stands for) and `term`
 * (the company's own word for an opportunity, in both languages). Extra keys of the shared envelope are kept.
 */
export const CrmBellRowSchema = z.looseObject({
  id: z.number().int().positive(),
  kind: CrmBellKindSchema,
  opportunity_id: z.number().int().positive(),
  title: z.string(),
  count: z.number().int().min(1),
  term: CrmTermSchema,
  created_at: z.string(),
  is_read: z.boolean(),
})

export type CrmBellKind = z.infer<typeof CrmBellKindSchema>
export type CrmBellRow = z.infer<typeof CrmBellRowSchema>
