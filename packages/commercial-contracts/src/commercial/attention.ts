import { z } from 'zod'

/** The vendor "today" list: concrete things that need the vendor's action, most urgent first. */
export const ATTENTION_LIMIT = 20
export const attentionKinds = ['past_due', 'refund_rejected', 'payment_method_unrevoked', 'billing_blocked', 'free_base_blocked', 'free_base_limits_pending', 'stalled_activation', 'operation_failed', 'setup_required', 'renewal_missed', 'renewal_soon'] as const
export const attentionKindSchema = z.enum(attentionKinds)

/** `refund_rejected` is a provider refund the refund worker could not turn into a credit note (money already left; `detail` is the machine reason) and stays until a credit note for that attempt exists. `payment_method_unrevoked` is a stored payment method the customer turned off that no payment attempt could name the provider of, so it is not revoked until an operator routes it (billing access). `billing_blocked` is a subscription whose invoice cannot be issued because its customer has no usable payment return origin. `free_base_limits_pending` is a trial that ended above the free limits: the paid applications are locked and nothing is deleted, only some limits wait for usage to fit (`detail` says what exceeds; informational). `free_base_blocked` is a trial that lapsed onto the free base whose entitlement could not be lowered yet (the tenant is usable; `detail` is the machine reason of the last attempt). `detail` is a machine value (order fulfillment state, operation type or lowering reason), translated by the client. `since` is when the situation began (the renewal date, as the start of that day in the business time zone, for the renewal kinds). */
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

/** Commercial counts for the status strip (queue and workspace counts come from the overview endpoint); `past_due` counts customers with an overdue invoice, as the `past_due` items do, and is null for callers without billing access; `renewals` counts the `renewal_missed` and `renewal_soon` subjects; `items` is capped at ATTENTION_LIMIT, `total` is the uncapped number of items the caller may see. */
export const attentionCountsSchema = z.strictObject({
  subscriptions_active: z.number().int().min(0),
  subscriptions_pending: z.number().int().min(0),
  past_due: z.number().int().min(0).nullable(),
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
