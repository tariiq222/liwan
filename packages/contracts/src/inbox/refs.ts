import { z } from 'zod'

/**
 * A contact named inside another record (an order, a form answer, a campaign recipient). `erased` marks the stored
 * language-neutral name an erase of the customer wrote, so the screen shows its own translated name instead.
 */
export const InboxContactRefSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  erased: z.boolean(),
}).strict()

export type InboxContactRef = z.infer<typeof InboxContactRefSchema>
