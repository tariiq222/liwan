import { describe, expect, it } from 'vitest'
import { acceptQuoteRequestSchema, initialOrderStates, nextOrderState, orderSchema, type EffectReceipt, type OrderStateInput } from '../commercial/index.js'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const sar = (minor: number) => ({ currency: 'SAR', exponent: 2, minor })
const st = (payment_state: OrderStateInput['payment_state'], fulfillment_state: OrderStateInput['fulfillment_state'], cancelled = false): OrderStateInput => ({ payment_state, fulfillment_state, cancelled })
const receipt: EffectReceipt = { order_id: 'o1', tenant_id: 't1', target_revision_id: id(1), observed_entitlement_digest: 'a'.repeat(64), observed_at: '2026-10-02T00:00:00Z', branch_bindings: [] }

describe('order schema', () => {
  it('parses an order and strict-rejects extras', () => {
    const o = { id: 'o1', customer_id: 'c', subscription_id: 's', kind: 'new', quote_id: 'q', target_revision_id: id(1), expected_applied_revision_id: null,
      payment_state: 'awaiting_payment', fulfillment_state: 'not_started', effective_at: null, idempotency_key: 'k', request_digest: 'd', due_now: sar(100), created_at: 'x' }
    expect(orderSchema.parse(o)).toEqual(o)
    expect(() => orderSchema.parse({ ...o, extra: 1 })).toThrow()
  })
  it('accept request requires uuid key and no prices', () => {
    expect(acceptQuoteRequestSchema.safeParse({ quote_id: 'q', expected_subscription_revision: 7, idempotency_key: id(2) }).success).toBe(true)
    expect(acceptQuoteRequestSchema.safeParse({ quote_id: 'q', expected_subscription_revision: 7, idempotency_key: 'nope' }).success).toBe(false)
    expect(acceptQuoteRequestSchema.safeParse({ quote_id: 'q', expected_subscription_revision: 7, idempotency_key: id(2), total: 1 }).success).toBe(false)
  })
})

describe('nextOrderState', () => {
  it('zero due_now is not_required and queued', () => {
    expect(initialOrderStates(sar(0))).toEqual({ payment_state: 'not_required', fulfillment_state: 'queued' })
    expect(initialOrderStates(sar(5))).toEqual({ payment_state: 'awaiting_payment', fulfillment_state: 'not_started' })
  })
  it('payment succeeded -> paid + queued', () => {
    const t = nextOrderState(st('awaiting_payment', 'not_started'), { type: 'payment_succeeded' })
    expect(t).toMatchObject({ payment_state: 'paid', fulfillment_state: 'queued', ignored: false, reconcile: false })
  })
  it('duplicate success and late pending/failed stay paid', () => {
    for (const e of ['payment_succeeded', 'payment_pending', 'payment_failed'] as const) {
      const t = nextOrderState(st('paid', 'applying'), { type: e })
      expect(t).toMatchObject({ payment_state: 'paid', fulfillment_state: 'applying', ignored: true })
    }
  })
  it('failed only from awaiting_payment', () => {
    expect(nextOrderState(st('awaiting_payment', 'not_started'), { type: 'payment_failed' }).payment_state).toBe('failed')
    expect(nextOrderState(st('not_required', 'queued'), { type: 'payment_failed' }).ignored).toBe(true)
  })
  it('paid after cancelled -> refund_pending + reconcile, no fulfillment', () => {
    const c = nextOrderState(st('awaiting_payment', 'not_started'), { type: 'order_cancelled' })
    expect(c.cancelled).toBe(true)
    const t = nextOrderState(st('awaiting_payment', 'not_started', true), { type: 'payment_succeeded' })
    expect(t).toMatchObject({ payment_state: 'refund_pending', fulfillment_state: 'not_started', reconcile: true })
    expect(() => nextOrderState(st('refund_pending', 'not_started', true), { type: 'fulfillment_started' })).toThrow()
  })
  it('paid orders cannot be cancelled', () => {
    expect(() => nextOrderState(st('paid', 'queued'), { type: 'order_cancelled' })).toThrow()
  })
  it('fulfillment path queued->applying->applied via receipt only', () => {
    const a = nextOrderState(st('paid', 'queued'), { type: 'fulfillment_started' })
    expect(a.fulfillment_state).toBe('applying')
    expect(nextOrderState(st('paid', 'applying'), { type: 'fulfillment_applied', receipt, target_revision_id: id(1) }).fulfillment_state).toBe('applied')
    expect(() => nextOrderState(st('paid', 'applying'), { type: 'fulfillment_applied', receipt, target_revision_id: id(9) })).toThrow()
    expect(() => nextOrderState(st('paid', 'queued'), { type: 'fulfillment_applied', receipt, target_revision_id: id(1) })).toThrow()
  })
  it('fulfillment cannot start unless paid|not_required', () => {
    for (const p of ['awaiting_payment', 'failed', 'refund_pending', 'refunded'] as const)
      expect(() => nextOrderState(st(p, 'queued'), { type: 'fulfillment_started' })).toThrow()
    expect(nextOrderState(st('not_required', 'queued'), { type: 'fulfillment_started' }).fulfillment_state).toBe('applying')
  })
  it('failure/intervention/retry', () => {
    expect(nextOrderState(st('paid', 'applying'), { type: 'fulfillment_failed' })).toMatchObject({ fulfillment_state: 'failed', reconcile: true })
    expect(nextOrderState(st('paid', 'failed'), { type: 'fulfillment_needs_intervention' }).fulfillment_state).toBe('needs_intervention')
    expect(nextOrderState(st('paid', 'needs_intervention'), { type: 'fulfillment_retry' }).fulfillment_state).toBe('queued')
    expect(() => nextOrderState(st('paid', 'applied'), { type: 'fulfillment_failed' })).toThrow()
  })
})
