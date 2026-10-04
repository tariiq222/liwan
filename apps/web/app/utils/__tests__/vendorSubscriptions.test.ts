import { describe, expect, it } from 'vitest'
import type { Order, SubscriptionView } from '@nasq/commercial-contracts'
import {
  commercialMetrics, customerListQuery, customersReturnTo, customerQuoteBody, normalizeQuoteResponse, withoutDraftTerms, emptyTermsDraft, invoiceListQuery, isNotAvailable, isStalled, targetStatus, termsPayload, usageDisplay, lineQuantities, formatBytes,
  type VendorCustomer,
} from '../vendorSubscriptions'

const now = new Date('2026-10-10T00:00:00Z')
const order = (o: Partial<Order> = {}) => ({ id: 'o', payment_state: 'paid', fulfillment_state: 'applying', created_at: '2026-10-10T00:00:00Z', ...o }) as Order
const sub = (o: Partial<SubscriptionView> = {}) => ({ id: 's', state: 'active', applied: { id: 'r1', cadence: { unit: 'month', count: 1 }, plan_revision_id: 'p', bundle_revision_ids: [], extra_branch_count: 1 }, target: null, pending_order: null, revision: 2, renewal_at: '2026-10-20', ...o }) as unknown as SubscriptionView
const cust = (s: SubscriptionView | null, setup = false): VendorCustomer => ({ id: 'c', name: 'n', tenant_id: null, commercial_setup_required: setup, subscription: s })

describe('queries', () => {
  it('maps filters and paging, dropping "all"', () => {
    expect(customerListQuery({ q: 'a', state: 'all', page: 3, pageSize: 25 })).toEqual({ q: 'a', state: undefined, limit: 25, offset: 50 })
    expect(invoiceListQuery({ customerId: 'c', status: 'paid', page: 1, pageSize: 25 })).toEqual({ customer_id: 'c', status: 'paid', limit: 25, offset: 0 })
  })
  it('keeps return links inside the customers list', () => {
    expect(customersReturnTo('/vendor/customers?q=a&page=2')).toBe('/vendor/customers?q=a&page=2')
    expect(customersReturnTo('https://evil.test')).toBe('/vendor/customers')
    expect(customersReturnTo('/vendor/customers/x')).toBe('/vendor/customers')
  })
})
describe('commercialMetrics', () => {
  it('counts states, renewals in window, stalled fulfillments and setup', () => {
    const m = commercialMetrics([
      cust(sub()), cust(sub({ state: 'pending', renewal_at: null })), cust(sub({ state: 'past_due', renewal_at: '2027-01-01' })),
      cust(sub({ pending_order: order({ fulfillment_state: 'failed' }) })), cust(null, true),
    ], now)
    expect(m).toMatchObject({ active: 2, pending: 1, pastDue: 1, upcomingRenewals: 2, stalledFulfillments: 1, setupRequired: 1, counted: 5 })
  })
  it('treats an old queued order as stalled, a fresh one not', () => {
    expect(isStalled(order({ fulfillment_state: 'queued', created_at: '2026-10-01T00:00:00Z' }), now)).toBe(true)
    expect(isStalled(order({ fulfillment_state: 'queued' }), now)).toBe(false)
    expect(isStalled(null, now)).toBe(false)
  })
})
describe('targetStatus', () => {
  it('never reports a pending target as applied', () => {
    expect(targetStatus(sub({ pending_order: order({ payment_state: 'awaiting_payment', fulfillment_state: 'not_started' }) }))).toBe('target_pending')
    expect(targetStatus(sub({ pending_order: order({ fulfillment_state: 'needs_intervention' }) }))).toBe('target_failed')
    expect(targetStatus(sub())).toBe('applied_only')
    expect(targetStatus(sub({ applied: null }))).toBe('none')
  })
})
describe('usage and invoices', () => {
  it('never turns unavailable usage into zero', () => {
    expect(usageDisplay({ used: null, limit: 5 })).toMatchObject({ available: false, used: null, ratio: null })
    expect(usageDisplay({ used: 0, limit: 5 })).toMatchObject({ available: true, used: 0, ratio: 0 })
    expect(usageDisplay({ used: 9, limit: 5 }).ratio).toBe(1)
  })
  it('splits free and paid quantities', () => {
    expect(lineQuantities({ quantity: 2, free_quantity: 1 })).toEqual({ free: 1, paid: 2 })
    expect(lineQuantities({ quantity: 2 })).toEqual({ free: null, paid: 2 })
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})
describe('terms payload', () => {
  it('sends only filled fields and requires a reason and an override', () => {
    const d = { ...emptyTermsDraft(), basePrice: '150.5', baseUnit: 'month' as const, includedExtraBranches: '3', reason: 'عقد خاص' }
    expect(termsPayload('c1', d)).toEqual({ customer_id: 'c1', reason: 'عقد خاص', base_price: { cadence: { unit: 'month', count: 1 }, amount: { currency: 'SAR', exponent: 2, minor: 15050 } }, included_extra_branches: 3 })
    expect(() => termsPayload('c1', { ...emptyTermsDraft(), reason: 'سبب' })).toThrow()
    expect(() => termsPayload('c1', { ...d, reason: '' })).toThrow()
  })
  it('blank limits mean inherit, explicit modes map to values, blank price is not zero', () => {
    const d = { ...emptyTermsDraft(), reason: 'سبب', users: { mode: 'unlimited' as const, value: '' }, storage: { mode: 'number' as const, value: '500' }, extraBranchesLimit: { mode: 'none' as const, value: '' } }
    const p = termsPayload('c', d)
    expect(p.limits).toEqual({ 'users.limit': null, 'storage.limit_mb': 500 }); expect(p.extra_branches_limit).toBe(0); expect(p.base_price).toBeUndefined()
    expect(() => termsPayload('c', { ...emptyTermsDraft(), reason: 'سبب', basePrice: '10' })).toThrow()
  })
  it('builds a customer quote preview from the target revision with terms', () => {
    const body = customerQuoteBody('c', sub(), { terms: { included_extra_branches: 4 } })
    expect(body).toMatchObject({ customer_id: 'c', kind: 'change', subscription_id: 's', expected_subscription_revision: 2, requested_extra_branches: 1, terms: { included_extra_branches: 4 } })
    expect(() => customerQuoteBody('c', sub({ applied: null }))).toThrow('no_subscription')
  })
})
describe('isNotAvailable', () => {
  it('detects 404 and 501 only', () => {
    expect(isNotAvailable({ status: 404 })).toBe(true); expect(isNotAvailable({ statusCode: 501 })).toBe(true); expect(isNotAvailable({ status: 500 })).toBe(false); expect(isNotAvailable(null)).toBe(false)
  })
  it('normalizes preview responses in both shapes and strips draft terms for change quotes', () => {
    expect(normalizeQuoteResponse({ id: 'q', preview: true })).toMatchObject({ preview: true, quote: { id: 'q' } })
    expect(normalizeQuoteResponse({ quote: { id: 'q' }, preview: true })).toEqual({ quote: { id: 'q' }, preview: true })
    expect(normalizeQuoteResponse({ id: 'q' }).preview).toBe(false)
    expect(withoutDraftTerms({ a: 1, terms: { x: 1 } })).toEqual({ a: 1 })
  })
})
