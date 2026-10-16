import { z } from 'zod'

/** The vendor "today" list: concrete things that need the vendor's action, most urgent first. */
export const ATTENTION_LIMIT = 20
export const attentionKinds = ['past_due', 'stalled_activation', 'operation_failed', 'setup_required', 'renewal_soon'] as const
export const attentionKindSchema = z.enum(attentionKinds)

/** `detail` is a machine value (order fulfillment state or operation type), translated by the client. `since` is when the situation began (the renewal date for `renewal_soon`). */
export const attentionItemSchema = z.strictObject({
  kind: attentionKindSchema,
  customer_id: z.uuid().nullable(),
  tenant_id: z.uuid().nullable(),
  operation_id: z.uuid().nullable(),
  invoice_id: z.uuid().nullable(),
  name: z.string().min(1),
  since: z.iso.datetime(),
  detail: z.string().nullable(),
})

/** Commercial counts for the status strip (queue and workspace counts come from the overview endpoint); `items` is capped at ATTENTION_LIMIT, `total` is the uncapped number of items the caller may see. */
export const attentionCountsSchema = z.strictObject({
  subscriptions_active: z.number().int().min(0),
  subscriptions_pending: z.number().int().min(0),
  past_due: z.number().int().min(0),
  stalled: z.number().int().min(0),
  setup_required: z.number().int().min(0),
  renewals: z.number().int().min(0),
})
export const attentionSchema = z.strictObject({
  items: z.array(attentionItemSchema).max(ATTENTION_LIMIT),
  total: z.number().int().min(0),
  counts: attentionCountsSchema,
})

export type AttentionKind = z.infer<typeof attentionKindSchema>
export type AttentionItem = z.infer<typeof attentionItemSchema>
export type AttentionCounts = z.infer<typeof attentionCountsSchema>
export type Attention = z.infer<typeof attentionSchema>
