import { z } from 'zod'
import { moneySchema, revisionIdSchema } from './schemas.js'
import { CommercialError } from './types.js'

export const paymentStateSchema = z.enum(['not_required', 'awaiting_payment', 'paid', 'failed', 'refund_pending', 'refunded'])
export const fulfillmentStateSchema = z.enum(['not_started', 'queued', 'applying', 'applied', 'failed', 'needs_intervention'])
export const orderKindSchema = z.enum(['new', 'change', 'renewal', 'branch_add', 'branch_archive'])

export const orderSchema = z.strictObject({
  id: z.string().min(1), customer_id: z.string().min(1), subscription_id: z.string().min(1),
  kind: orderKindSchema, quote_id: z.string().min(1),
  target_revision_id: revisionIdSchema, expected_applied_revision_id: revisionIdSchema.nullable(),
  payment_state: paymentStateSchema, fulfillment_state: fulfillmentStateSchema,
  effective_at: z.string().nullable(), idempotency_key: z.string().min(1), request_digest: z.string().min(1),
  due_now: moneySchema, created_at: z.string(),
})
// Accepting a quote: ids only. Prices/totals never come from the caller.
export const acceptQuoteRequestSchema = z.strictObject({
  quote_id: z.string().min(1), expected_subscription_revision: z.number().int().min(0),
  idempotency_key: z.uuid(),
})
// Receipt is the ONLY way an order becomes `applied`.
export const effectReceiptSchema = z.strictObject({
  order_id: z.string().min(1), tenant_id: z.string().min(1), target_revision_id: revisionIdSchema,
  observed_entitlement_digest: z.string().regex(/^[a-f0-9]{64}$/), observed_at: z.string(),
  branch_bindings: z.array(z.strictObject({ branch_id: z.uuid(), odoo_company_id: z.number().int().positive() })),
})

export type PaymentState = z.infer<typeof paymentStateSchema>
export type FulfillmentState = z.infer<typeof fulfillmentStateSchema>
export type OrderKind = z.infer<typeof orderKindSchema>
export type Order = z.infer<typeof orderSchema>
export type AcceptQuoteRequest = z.infer<typeof acceptQuoteRequestSchema>
export type EffectReceipt = z.infer<typeof effectReceiptSchema>

export type OrderStateInput = {
  payment_state: PaymentState
  fulfillment_state: FulfillmentState
  /** Order was cancelled by the customer/vendor before payment settled. */
  cancelled?: boolean
}
export type OrderEvent =
  | { type: 'payment_pending' }
  | { type: 'payment_succeeded' }
  | { type: 'payment_failed' }
  | { type: 'payment_refunded' }
  | { type: 'order_cancelled' }
  | { type: 'fulfillment_started' }
  | { type: 'fulfillment_applied'; receipt: EffectReceipt; target_revision_id: string }
  | { type: 'fulfillment_failed' }
  | { type: 'fulfillment_needs_intervention' }
  | { type: 'fulfillment_retry' }
export type OrderTransition = {
  payment_state: PaymentState
  fulfillment_state: FulfillmentState
  cancelled: boolean
  /** Money moved but service must NOT activate: needs manual reconciliation / refund. */
  reconcile: boolean
  /** Duplicate/late event with no effect (audit only). */
  ignored: boolean
}

/** Initial states at acceptance: zero due_now needs no payment and goes straight to the fulfillment queue. */
export function initialOrderStates(due_now: { minor: number }): Pick<OrderTransition, 'payment_state' | 'fulfillment_state'> {
  return due_now.minor === 0
    ? { payment_state: 'not_required', fulfillment_state: 'queued' }
    : { payment_state: 'awaiting_payment', fulfillment_state: 'not_started' }
}

const mayFulfil = (p: PaymentState) => p === 'paid' || p === 'not_required'

/**
 * Pure order state machine. Returns the next states or throws CommercialError('invalid_order_transition').
 * Duplicates/late events return `ignored: true` with unchanged states (paid never regresses to pending/failed).
 */
export function nextOrderState(order: OrderStateInput, event: OrderEvent): OrderTransition {
  const cancelled = order.cancelled === true
  const cur: OrderTransition = { payment_state: order.payment_state, fulfillment_state: order.fulfillment_state, cancelled, reconcile: false, ignored: false }
  const ignore = (): OrderTransition => ({ ...cur, ignored: true })
  const bad = (): never => { throw new CommercialError('invalid_order_transition', event.type) }
  const p = order.payment_state
  const f = order.fulfillment_state

  switch (event.type) {
    case 'payment_pending':
      return ignore() // pending never changes state: awaiting stays awaiting, paid stays paid
    case 'payment_succeeded':
      if (cancelled && (p === 'awaiting_payment' || p === 'failed')) return { ...cur, payment_state: 'refund_pending', reconcile: true }
      if (p === 'awaiting_payment' || p === 'failed') return { ...cur, payment_state: 'paid', fulfillment_state: f === 'not_started' ? 'queued' : f }
      return ignore() // paid/not_required/refund_pending/refunded duplicates
    case 'payment_failed':
      if (p === 'awaiting_payment') return { ...cur, payment_state: 'failed' }
      return ignore() // failed only from awaiting_payment; late failure after paid is ignored
    case 'payment_refunded':
      if (p === 'paid' || p === 'refund_pending') return { ...cur, payment_state: 'refunded', reconcile: false }
      return ignore()
    case 'order_cancelled':
      if (cancelled) return ignore()
      if ((p === 'awaiting_payment' || p === 'failed') && f === 'not_started') return { ...cur, cancelled: true }
      return bad() // paid/started orders cannot be cancelled here (downgrade/cancel happen at renewal)
    case 'fulfillment_started':
      if (!mayFulfil(p) || cancelled) return bad()
      if (f === 'queued') return { ...cur, fulfillment_state: 'applying' }
      if (f === 'applying' || f === 'applied') return ignore()
      return bad()
    case 'fulfillment_applied':
      if (!mayFulfil(p) || cancelled) return bad()
      if (event.receipt.target_revision_id !== event.target_revision_id) return bad()
      if (f === 'applied') return ignore()
      if (f === 'applying') return { ...cur, fulfillment_state: 'applied' }
      return bad()
    case 'fulfillment_failed':
      if (f === 'applying') return { ...cur, fulfillment_state: 'failed', reconcile: p === 'paid' }
      if (f === 'failed') return ignore()
      return bad()
    case 'fulfillment_needs_intervention':
      if (f === 'applying' || f === 'failed') return { ...cur, fulfillment_state: 'needs_intervention', reconcile: p === 'paid' }
      if (f === 'needs_intervention') return ignore()
      return bad()
    case 'fulfillment_retry':
      if (!mayFulfil(p) || cancelled) return bad()
      if (f === 'failed' || f === 'needs_intervention') return { ...cur, fulfillment_state: 'queued' }
      return bad()
  }
}
