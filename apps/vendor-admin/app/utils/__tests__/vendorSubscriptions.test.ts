import { describe, expect, it } from 'vitest'
import type { Invoice, Order, SubscriptionView } from '@liwan/commercial-contracts'
import {
  customersReturnTo, customerQuoteBody, normalizeQuoteResponse, withoutDraftTerms, emptyTermsDraft, daysUntilDate, invoiceListQuery, isNotAvailable, isStalled, targetStatus, termsPayload, usageDisplay, usageMetricLabel, lineQuantities, formatBytes, vendorInvoiceLineViews,
  type VendorCustomer,
} from '../vendorSubscriptions'
import { formatCommercialMoney } from '@liwan/commercial-ui/app/utils/commercial'
import { sar } from '../vendorCommercial'

const now = new Date('2026-10-10T00:00:00Z')
const order = (o: Partial<Order> = {}) => ({ id: 'o', payment_state: 'paid', fulfillment_state: 'applying', created_at: '2026-10-10T00:00:00Z', ...o }) as Order
const sub = (o: Partial<SubscriptionView> = {}) => ({ id: 's', state: 'active', applied: { id: 'r1', cadence: { unit: 'month', count: 1 }, plan_revision_id: 'p', bundle_revision_ids: [], extra_branch_count: 1, entitlement: { features: { 'users.limit': 10, 'storage.limit_mb': 10240 } } }, target: null, pending_order: null, revision: 2, renewal_at: '2026-10-20', ...o }) as unknown as SubscriptionView
const cust = (s: SubscriptionView | null, setup = false): VendorCustomer => ({ id: 'c', name: 'n', tenant_id: null, commercial_setup_required: setup, subscription: s })

describe('queries', () => {
  it('maps invoice filters and paging, dropping "all"', () => {
    expect(invoiceListQuery({ customerId: 'c', status: 'paid', page: 1, pageSize: 25 })).toEqual({ customer_id: 'c', status: 'paid', limit: 25, offset: 0 })
  })
  it('keeps return links inside the customers list', () => {
    expect(customersReturnTo('/customers?q=a&page=2')).toBe('/customers?q=a&page=2')
    expect(customersReturnTo('https://evil.test')).toBe('/customers')
    expect(customersReturnTo('/customers/x')).toBe('/customers')
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
  it('maps the branch limit and never sends metered capacity overrides', () => {
    const d = { ...emptyTermsDraft(), reason: 'سبب', extraBranchesLimit: { mode: 'none' as const, value: '' } }
    const p = termsPayload('c', d)
    expect(p.extra_branches_limit).toBe(0); expect(p.base_price).toBeUndefined()
    expect(p).not.toHaveProperty('limits')
    expect(() => termsPayload('c', { ...emptyTermsDraft(), reason: 'سبب', basePrice: '10' })).toThrow()
  })
  it('builds a customer quote preview from the target revision with terms', () => {
    const body = customerQuoteBody('c', sub(), { terms: { included_extra_branches: 4 } })
    expect(body).toMatchObject({ customer_id: 'c', kind: 'change', subscription_id: 's', expected_subscription_revision: 2, requested_extra_branches: 1, requested_users: 10, requested_storage_mb: 10240, terms: { included_extra_branches: 4 } })
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

describe('vendorInvoiceLineViews', () => {
  const t = (key: string) => `t:${key}`
  const line = { key: 'l1', kind: 'branch', timing: 'now', description: 'Branches', quantity: 3, free_quantity: 1,
    unit_amount: sar(10000), amount: sar(30000), period_start: '2026-10-01', period_end: '2026-10-31', source_revision_id: 'r' } as Invoice['lines'][number]

  it('keeps the vendor table columns and quantities, with money formatted', () => {
    const [view] = vendorInvoiceLineViews([line], t, 'en')
    expect(view!.id).toBe('l1')
    expect(view!.kind).toEqual({ label: 't:vendor.invoices.lineKind.branch', tone: 'neutral' })
    expect(view!.cells.map(c => [c.key, c.value])).toEqual([
      ['free', '1'], ['paid', '3'], ['unit', formatCommercialMoney(sar(10000), 'en')], ['period', '2026-10-01 → 2026-10-31'],
    ])
    expect(view!.cells.map(c => c.label)).toEqual(['t:vendor.invoices.line.free', 't:vendor.invoices.line.paid', 't:vendor.invoices.line.unit', 't:vendor.invoices.line.period'])
    expect(view!.amount).toBe(formatCommercialMoney(sar(30000), 'en'))
  })

  it('shows not-available, never 0, when a line has no free quantity', () => {
    const [view] = vendorInvoiceLineViews([{ ...line, free_quantity: undefined }], t, 'en')
    expect(view!.cells[0]!.value).toBe('t:app.notAvailable')
  })
})

describe('usageMetricLabel', () => {
  const messages: Record<string, string> = {
    'vendor.customers.usage.keys.users_limit': 'Users',
    'vendor.customers.usage.units.count': 'Usage',
  }
  const t = (key: string) => messages[key] ?? key
  const te = (key: string) => key in messages

  it('prefers the limit key, then the unit, then a readable id', () => {
    expect(usageMetricLabel({ key: 'users.limit', unit: 'count' }, t, te)).toBe('Users')
    expect(usageMetricLabel({ key: 'other.limit', unit: 'count' }, t, te)).toBe('Usage')
    expect(usageMetricLabel({ key: 'other.limit', unit: 'users' }, t, te)).toBe('Other limit')
  })
})

describe('customer glance helpers', () => {
  const now = new Date('2026-10-16T10:00:00Z')
  const order = (o: Partial<Order>) => ({ fulfillment_state: 'queued', created_at: '2026-10-16T09:00:00Z', ...o }) as Order
  it('counts calendar days to a date', () => {
    expect(daysUntilDate('2026-10-20', now)).toBe(4)
    expect(daysUntilDate('2026-10-16', now)).toBe(0)
  })
  it('flags failed orders and queued ones older than a day', () => {
    expect(isStalled(order({ fulfillment_state: 'failed' }), now)).toBe(true)
    expect(isStalled(order({ created_at: '2026-10-14T00:00:00Z' }), now)).toBe(true)
    expect(isStalled(order({}), now)).toBe(false)
    expect(isStalled(null, now)).toBe(false)
  })
})
