import { z } from 'zod'
import { RefSchema } from './task'

export const TimelineEntrySchema = z.object({
  id: z.number().int().positive(), kind: z.enum(['comment', 'tracking']), author: RefSchema.nullable(), at: z.string(),
  body_html: z.string().optional(),
  changes: z.array(z.object({ field: z.string(), label: z.string(), old: z.any(), new: z.any() }).strict()).optional(),
}).strict()
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>
