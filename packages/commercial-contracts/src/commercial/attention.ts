import { z } from 'zod'

/** The vendor "today" list: concrete things that need the vendor's action, most urgent first. */
export const ATTENTION_LIMIT = 20
export const attentionKinds = ['past_due', 'refund_rejected', 'billing_blocked', 'free_base_blocked', 'renewal_failed', 'trial_end_overdue', 'free_base_holding', 'stalled_activation', 'operation_failed', 'setup_required', 'renewal_missed', 'renewal_soon'] as const
export const attentionKindSchema = z.enum(attentionKinds)

/** `refund_rejected` is a provider refund the refund worker could not turn into a credit note (money already left; `detail` is the machine reason) and stays until a credit note for that attempt exists. `billing_blocked` is a subscription whose invoice cannot be issued because its customer has no usable payment return origin. `free_base_holding` is a trial that ended above the free quantities: the paid applications are locked, nothing is deleted or lowered, and the customer keeps the users, storage or extra branches above the included ones free until they name a quantity or buy a branch (`detail` says what is held; informational and persistent). `trial_end_overdue` is a trial whose end date passed more than two scheduler intervals ago without the end running: new orders answer `trial_ending` until it does. `renewal_failed` is a subscription whose renewal could not be generated (`detail` is the machine reason; the other subscriptions kept renewing) until one is generated. `free_base_blocked` is a trial that lapsed onto the free base whose paid applications could not be locked yet (the tenant is usable; `detail` is the machine reason of the last attempt). `detail` is a machine value (order fulfillment state, operation type or lowering reason), translated by the client. `since` is when the situation began (the renewal date, as the start of that day in the business time zone, for the renewal kinds). */
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
