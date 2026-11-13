import { describe, expect, it } from 'vitest'
import { freeBaseLockCauseSchema, subscriptionCancellationSchema, subscriptionViewSchema } from '../commercial/subscriptions.js'

const base = {
  id: 's1', customer_id: 'c1', tenant_id: null, state: 'active', applied: null, target: null, pending_order: null, order_cancelled: false, revision: 3,
  renewal_at: '2026-12-12', auto_renew: { enabled: false, consent_at: null, payment_method: null }, trial_ends_at: null, grace_ends_at: null,
}

describe('the cancellation fact on a subscription view', () => {
  it('names the cancelled lock cause beside the other three', () => {
    expect(freeBaseLockCauseSchema.options).toEqual(['trial_end', 'first_invoice_unpaid', 'refund', 'cancelled'])
  })
  it('carries who asked, when, and the date it takes effect', () => {
    const cancellation = { requested_at: '2026-11-20T09:00:00.000Z', requested_by: 'customer', effective_on: '2026-12-12' }
    expect(subscriptionViewSchema.parse({ ...base, cancellation, cancellable: false }).cancellation).toEqual(cancellation)
    expect(subscriptionViewSchema.parse({ ...base, cancellation: null, cancellable: true }).cancellable).toBe(true)
  })
  it('refuses a requester that is neither the customer nor the vendor, and unknown fields', () => {
    expect(subscriptionCancellationSchema.safeParse({ requested_at: 'x', requested_by: 'system', effective_on: '2026-12-12' }).success).toBe(false)
    expect(subscriptionCancellationSchema.safeParse({ requested_at: 'x', requested_by: 'vendor', effective_on: '2026-12-12', reason: 'private' }).success).toBe(false)
  })
})
