import { describe, expect, it } from 'vitest'
import { branchBillingCounts, branchQuoteRequestSchema, principalSchema, renewalKey, subscriptionDisplayState, subscriptionViewSchema, usageSnapshotSchema, type Order, type SubscriptionView } from '../commercial/index.js'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const sar = (minor: number) => ({ currency: 'SAR', exponent: 2, minor })
const order = (p: Order['payment_state'], f: Order['fulfillment_state']): Order => ({ id: 'o', customer_id: 'c', subscription_id: 's', kind: 'new', quote_id: 'q', target_revision_id: id(1),
  expected_applied_revision_id: null, payment_state: p, fulfillment_state: f, effective_at: null, idempotency_key: 'k', request_digest: 'd', due_now: sar(1), created_at: 'x' })
const rev = { id: id(1), subscription_id: 's', revision: 1, customer_id: 'c', tenant_id: 't', plan_revision_id: id(2), bundle_revision_ids: [], terms_revision_id: null, policy_revision_id: id(3),
  cadence: { unit: 'month', count: 1 }, term_start: '2026-10-01', term_end: '2027-09-30', period_start: '2026-10-01', period_end: '2026-10-31', included_extra_branches: 1, extra_branch_count: 0,
  entitlement: { catalog_release_id: id(4), modules: [], features: {}, compiler_version: 'x', digest: 'a'.repeat(64) }, quote_id: 'q', created_at: 'x' }
const view = (o: Partial<SubscriptionView> = {}): SubscriptionView => ({ id: 's', customer_id: 'c', tenant_id: null, state: 'pending', applied: null, target: null, pending_order: null, order_cancelled: false, revision: 0,
  renewal_at: null, auto_renew: { enabled: false, consent_at: null, token_ref_present: false }, trial_ends_at: null, grace_ends_at: null, ...o })

describe('subscription view + display state', () => {
  it('parses a view', () => { expect(subscriptionViewSchema.parse(view({ applied: rev as never, target: rev as never, state: 'active' })).state).toBe('active') })
  it('maps order progress without premature active', () => {
    expect(subscriptionDisplayState(view({ pending_order: order('awaiting_payment', 'not_started') }))).toBe('awaiting_payment')
    expect(subscriptionDisplayState(view({ pending_order: order('paid', 'queued') }))).toBe('activating')
    expect(subscriptionDisplayState(view({ pending_order: order('paid', 'applying') }))).toBe('activating')
    expect(subscriptionDisplayState(view({ pending_order: order('paid', 'applied') }))).toBe('activating')
    expect(subscriptionDisplayState(view({ pending_order: order('paid', 'needs_intervention') }))).toBe('failed')
    expect(subscriptionDisplayState(view({ pending_order: order('failed', 'not_started') }))).toBe('awaiting_payment')
    expect(subscriptionDisplayState(view({ pending_order: order('paid', 'queued'), state: 'active', applied: rev as never }))).toBe('activating')
  })
  it('active only with applied revision', () => {
    expect(subscriptionDisplayState(view({ state: 'active', applied: rev as never }))).toBe('active')
    expect(subscriptionDisplayState(view({ state: 'active', applied: null }))).toBe('activating')
    expect(subscriptionDisplayState(view({ state: 'suspended', applied: rev as never }))).toBe('inactive')
  })
  it('a never-applied subscription whose order was cancelled is inactive, not awaiting payment', () => {
    expect(subscriptionDisplayState(view())).toBe('awaiting_payment')
    expect(subscriptionDisplayState(view({ order_cancelled: true }))).toBe('inactive')
  })
})
describe('renewalKey', () => { it('is stable per period+kind', () => {
  expect(renewalKey('s', '2026-11-01', 'renewal')).toBe(renewalKey('s', '2026-11-01', 'renewal'))
  expect(renewalKey('s', '2026-11-01', 'renewal')).not.toBe(renewalKey('s', '2026-12-01', 'renewal'))
  expect(renewalKey('s', '2026-11-01', 'renewal')).not.toBe(renewalKey('s', '2026-11-01', 'change'))
}) })
describe('branchBillingCounts', () => {
  const b = (kind: 'hq' | 'extra', state: 'pending' | 'active' | 'archived' | 'failed') => ({ kind, state })
  it('hq excluded; pending+active reserve; archived/failed do not', () => {
    expect(branchBillingCounts([b('hq', 'active'), b('extra', 'active'), b('extra', 'active'), b('extra', 'pending'), b('extra', 'archived'), b('extra', 'failed')], 1)).toEqual({ hq: 1, extra_active: 3, free_used: 1, paid: 2 })
    expect(branchBillingCounts([b('hq', 'active')], 2)).toEqual({ hq: 1, extra_active: 0, free_used: 0, paid: 0 })
  })
  it('quote request needs a change', () => {
    expect(branchQuoteRequestSchema.safeParse({ subscription_id: 's', expected_subscription_revision: 1, add: [], archive: [] }).success).toBe(false)
    expect(branchQuoteRequestSchema.safeParse({ subscription_id: 's', expected_subscription_revision: 1, add: [{ name: 'جدة' }], archive: [] }).success).toBe(true)
  })
})
describe('usage + principal', () => {
  it('never defaults unavailable to 0', () => {
    const base = { tenant_id: 't', policy_revision_id: id(1) }
    expect(usageSnapshotSchema.safeParse({ ...base, observed_at: null, freshness: 'unavailable', metrics: [{ key: 'users', used: null, limit: 5, unit: 'users', reason: 'timeout' }] }).success).toBe(true)
    expect(usageSnapshotSchema.safeParse({ ...base, observed_at: null, freshness: 'unavailable', metrics: [{ key: 'users', used: 0, limit: 5, unit: 'users', reason: null }] }).success).toBe(false)
    expect(usageSnapshotSchema.safeParse({ ...base, observed_at: 'x', freshness: 'fresh', metrics: [{ key: 'users', used: null, limit: 5, unit: 'users', reason: null }] }).success).toBe(false)
  })
  it('customer principal needs customer_id', () => {
    expect(principalSchema.safeParse({ actor_id: 'a', kind: 'customer', customer_id: null, tenant_id: null, capabilities: [] }).success).toBe(false)
    expect(principalSchema.safeParse({ actor_id: 'a', kind: 'customer', customer_id: 'c', tenant_id: 't', capabilities: ['subscription.read'] }).success).toBe(true)
  })
})
