import { z } from 'zod'
import { cadenceSchema, entitlementSnapshotSchema, revisionIdSchema } from './schemas.js'
import { orderSchema, type Order } from './orders.js'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** Commercial state; fulfillment lives on the Order, never here. */
export const subscriptionStateSchema = z.enum(['pending', 'trialing', 'active', 'past_due', 'suspended', 'cancelled'])

export const subscriptionRevisionSchema = z.strictObject({
  id: revisionIdSchema, subscription_id: z.string().min(1), revision: z.number().int().positive(),
  customer_id: z.string().min(1), tenant_id: z.string().min(1),
  plan_revision_id: revisionIdSchema, bundle_revision_ids: z.array(revisionIdSchema),
  terms_revision_id: revisionIdSchema.nullable(), policy_revision_id: revisionIdSchema,
  cadence: cadenceSchema, term_start: isoDate, term_end: isoDate, period_start: isoDate, period_end: isoDate,
  included_extra_branches: z.number().int().min(0), extra_branch_count: z.number().int().min(0),
  entitlement: entitlementSnapshotSchema, quote_id: z.string().min(1), created_at: z.string(),
})
export const subscriptionViewSchema = z.strictObject({
  id: z.string().min(1), customer_id: z.string().min(1), tenant_id: z.string().nullable(),
  state: subscriptionStateSchema,
  applied: subscriptionRevisionSchema.nullable(), target: subscriptionRevisionSchema.nullable(),
  pending_order: orderSchema.nullable(),
  /** A never-applied subscription whose order was cancelled: nothing is owed and nothing will be activated. */
  order_cancelled: z.boolean(),
  revision: z.number().int().min(0), // aggregate version used for optimistic locking
  renewal_at: isoDate.nullable(),
  auto_renew: z.strictObject({ enabled: z.boolean(), consent_at: z.string().nullable(), token_ref_present: z.boolean() }),
  trial_ends_at: z.string().nullable(), grace_ends_at: z.string().nullable(),
})

export type SubscriptionState = z.infer<typeof subscriptionStateSchema>
export type SubscriptionRevision = z.infer<typeof subscriptionRevisionSchema>
export type SubscriptionView = z.infer<typeof subscriptionViewSchema>

/** UI label keys → بانتظار الدفع / جارٍ التفعيل / مفعّل / تعذر التنفيذ. `inactive` = suspended/cancelled. */
export type SubscriptionDisplayState = 'awaiting_payment' | 'activating' | 'active' | 'failed' | 'inactive'
export const SUBSCRIPTION_DISPLAY_LABELS_AR: Record<SubscriptionDisplayState, string> = {
  awaiting_payment: 'بانتظار الدفع', activating: 'جارٍ التفعيل', active: 'مفعّل', failed: 'تعذر التنفيذ', inactive: 'متوقف',
}

type DisplayInput = Pick<SubscriptionView, 'state' | 'applied' | 'pending_order'> & Partial<Pick<SubscriptionView, 'order_cancelled'>>

/** Never 'active' because payment succeeded or a job was queued: applied needs a receipt-verified applied revision. */
export function subscriptionDisplayState(view: DisplayInput): SubscriptionDisplayState {
  const o: Order | null = view.pending_order
  if (o) {
    if (o.fulfillment_state === 'failed' || o.fulfillment_state === 'needs_intervention') return 'failed'
    if (o.payment_state === 'awaiting_payment' || o.payment_state === 'failed') return 'awaiting_payment'
    if (o.payment_state === 'refund_pending' || o.payment_state === 'refunded') return 'failed'
    // paid / not_required but fulfillment not confirmed (incl. 'applied' not yet reflected in applied revision)
    return 'activating'
  }
  switch (view.state) {
    case 'suspended': case 'cancelled': return 'inactive'
    case 'pending': return view.applied ? 'activating' : view.order_cancelled ? 'inactive' : 'awaiting_payment'
    default: return view.applied ? 'active' : 'activating'
  }
}

export const renewalInvoiceKinds = ['initial', 'change', 'renewal', 'adjustment'] as const
/** Idempotency key for one renewal per period: subscription_id + period_start + invoice kind. */
export function renewalKey(subscription_id: string, period_start: string, kind: (typeof renewalInvoiceKinds)[number] | string): string {
  return `${subscription_id}:${period_start}:${kind}`
}
