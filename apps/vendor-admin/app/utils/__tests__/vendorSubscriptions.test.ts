import { describe, expect, it } from 'vitest'
import type { Adjustment, Invoice, Order, SubscriptionView } from '@liwan/commercial-contracts'
import {
  customersReturnTo, customerQuoteBody, normalizeQuoteResponse, withoutDraftTerms, emptyTermsDraft, daysUntilDate, invoiceListQuery, isNotAvailable, isStalled, targetStatus, termsPayload, usageDisplay, usageMetricLabel, lineQuantities, formatBytes, vendorInvoiceLineViews, parseTransferAmount, refundRequestBlock, voidAction, voidErrorKey, voidReasonKey, validVoidDraft, aiTopupRefundable, transferFormDefaults, validRefundDraft, validRefundReason,
  planBundleIds, requestedQuantities, currentPaidQuantities, orderOutcomeUnknown,
  type VendorCustomer, type VendorInvoice, adminLoginErrorKey, cardActionErrorKey, deletionErrorKey,
} from '../vendorSubscriptions'
import { formatCommercialMoney } from '@liwan/commercial-ui/app/utils/commercial'
import { sar } from '../vendorCommercial'

const now = new Date('2026-10-10T00:00:00Z')
const order = (o: Partial<Order> = {}) => ({ id: 'o', payment_state: 'paid', fulfillment_state: 'applying', created_at: '2026-10-10T00:00:00Z', ...o }) as Order
const sub = (o: Partial<SubscriptionView> = {}) => ({ id: 's', state: 'active', applied: { id: 'r1', cadence: { unit: 'month', count: 1 }, plan_revision_id: 'p', bundle_revision_ids: [], extra_branch_count: 1, entitlement: { features: { 'users.limit': 10, 'storage.limit_mb': 10240 } } }, target: null, pending_order: null, revision: 2, renewal_at: '2026-10-20', ...o }) as unknown as SubscriptionView
const cust = (s: SubscriptionView | null, setup = false): VendorCustomer => ({ id: 'c', name: 'n', tenant_id: null, admin_login: null, commercial_setup_required: setup, signup_acceptance: null, subscription: s })

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
  it('asks for the terms in force with preview, which the plain body never carries', () => {
    expect(customerQuoteBody('c', sub(), { preview: true })).toMatchObject({ preview: true })
    expect(customerQuoteBody('c', sub())).not.toHaveProperty('preview')
  })
})
describe('a first paid subscription and a full subscription change', () => {
  const plan = { included_bundle_revision_ids: ['b1'], optional_bundle_revision_ids: ['b2', 'b3'], included_users: 10, included_storage_mb: 10240 }
  const month = { unit: 'month' as const, count: 1 }
  it('quotes a customer with no subscription as a new subscription at revision 0, carrying the onboarding line', () => {
    const body = customerQuoteBody('c', null, { planRevisionId: 'p', bundleIds: ['b1'], cadence: month, onboarding: true })
    expect(body).toMatchObject({ customer_id: 'c', kind: 'new', plan_revision_id: 'p', expected_subscription_revision: 0, onboarding: true })
    expect(body).not.toHaveProperty('subscription_id')
    expect(customerQuoteBody('c', null, { planRevisionId: 'p', bundleIds: ['b1'], cadence: month })).not.toHaveProperty('onboarding')
  })
  it('builds the bundles from the new plan: its included ones and the chosen optional ones it offers', () => {
    expect(planBundleIds(plan, ['b3', 'old-plan-bundle', 'b1'])).toEqual(['b1', 'b3'])
    expect(planBundleIds(plan, [])).toEqual(['b1'])
  })
  it('turns paid users and paid storage into the requested totals', () => {
    expect(requestedQuantities(plan, { paidUsers: 5, paidStorageGb: 2 })).toEqual({ users: 15, storageMb: 12288 })
  })
  it('keeps what the customer has: the current totals above the new plan inclusions, never below', () => {
    const view = sub()
    expect(currentPaidQuantities(plan, view)).toEqual({ paidUsers: 0, paidStorageGb: 0 })
    expect(currentPaidQuantities({ ...plan, included_users: 4, included_storage_mb: 5120 }, view)).toEqual({ paidUsers: 6, paidStorageGb: 5 })
    expect(currentPaidQuantities(plan, null)).toEqual({ paidUsers: 0, paidStorageGb: 0 })
  })
  it('keeps an order key only when the outcome of the attempt is unknown', () => {
    expect(orderOutcomeUnknown({ status: 503 })).toBe(true)
    expect(orderOutcomeUnknown(new TypeError('fetch failed'))).toBe(true)
    expect(orderOutcomeUnknown({ status: 422, data: { code: 'quote_expired' } })).toBe(false)
    expect(orderOutcomeUnknown({ status: 409, data: { code: 'revision_conflict' } })).toBe(false)
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

describe('refund request', () => {
  const refund = (o: Partial<VendorInvoice['refund']> = {}) => ({ refundable: true, first_payment: true, until: '2026-11-20T23:59:59+03:00', window_days: 14, locks_subscription: false, ...o })
  const note = (o: Partial<Adjustment> = {}) => ({ id: 'n', kind: 'credit_note', origin: 'vendor', status: 'pending', ...o }) as Adjustment
  it('is open only for a refundable payment with no vendor note yet', () => {
    expect(refundRequestBlock({ refund: refund(), adjustments: [] })).toBeNull()
    expect(refundRequestBlock({ refund: refund(), adjustments: [note({ origin: 'system' })] })).toBeNull()
    expect(refundRequestBlock({ refund: refund(), adjustments: [note({ status: 'void' })] })).toBeNull()
    expect(refundRequestBlock({ refund: refund(), adjustments: [note({ kind: 'debit_note' })] })).toBeNull()
  })
  it('names the one reason it is closed: a vendor note, the window, or a later payment', () => {
    expect(refundRequestBlock({ refund: refund(), adjustments: [note()] })).toBe('alreadyRequested')
    expect(refundRequestBlock({ refund: refund(), adjustments: [note({ status: 'refunded' })] })).toBe('alreadyRequested')
    // An existing request wins over the date: it is the more useful thing to tell the vendor.
    expect(refundRequestBlock({ refund: refund({ refundable: false }), adjustments: [note()] })).toBe('alreadyRequested')
    expect(refundRequestBlock({ refund: refund({ refundable: false }), adjustments: [] })).toBe('windowClosed')
    expect(refundRequestBlock({ refund: refund({ refundable: false, first_payment: false, until: null }), adjustments: [] })).toBe('notFirstPayment')
  })
  it('bounds the reason like the server: 3 to 1000 characters after trimming', () => {
    expect(validRefundReason('ab')).toBe(false); expect(validRefundReason('  ab  ')).toBe(false)
    expect(validRefundReason('abc')).toBe(true); expect(validRefundReason('x'.repeat(1000))).toBe(true); expect(validRefundReason('x'.repeat(1001))).toBe(false)
    expect(validRefundDraft({ reference: 'MOY-1', reason: 'done' })).toBe(true); expect(validRefundDraft({ reference: 'MO', reason: 'done' })).toBe(false)
  })
})

describe('bank transfer form values', () => {
  it('opens on the invoice total and on the Riyadh calendar day, not the UTC one', () => {
    const total = sar(12345)
    expect(transferFormDefaults(total, new Date('2026-11-07T20:59:59Z'))).toEqual({ amount: '123.45', valueDate: '2026-11-07', reference: '' })
    expect(transferFormDefaults(total, new Date('2026-11-07T21:00:00Z'))).toEqual({ amount: '123.45', valueDate: '2026-11-08', reference: '' })
    expect(transferFormDefaults(sar(10000), new Date('2026-11-07T12:00:00Z')).amount).toBe('100.00')
  })
  it('reads riyals exactly, with Arabic-Indic digits, and never rounds', () => {
    expect(parseTransferAmount('123.45', 2)).toEqual({ minor: 12345 })
    expect(parseTransferAmount('١٢٣٫٤٥', 2)).toEqual({ minor: 12345 })
    expect(parseTransferAmount(' 100 ', 2)).toEqual({ minor: 10000 })
    expect(parseTransferAmount('0.29', 2)).toEqual({ minor: 29 })
    expect(parseTransferAmount('123.456', 2)).toEqual({ issue: 'decimals' })
    expect(parseTransferAmount('١٢٣٫٤٥٦', 2)).toEqual({ issue: 'decimals' })
    for (const text of ['', 'abc', '-5', '1e3', '12.3.4']) expect(parseTransferAmount(text, 2), text).toEqual({ issue: 'invalid' })
  })
})

describe('deletionErrorKey', () => {
  it('names the closed window and leaves every other failure to the shared message', () => {
    expect(deletionErrorKey({ status: 409, data: { code: 'deletion_in_progress' } })).toBe('vendor.customers.deletion.errors.deletion_in_progress')
    expect(deletionErrorKey({ status: 404, data: { code: 'not_found' } })).toBe('vendor.pricing.errors.not_found')
  })
})

describe('cardActionErrorKey', () => {
  it('says the card stays when the provider cannot delete it, and falls back to the shared message otherwise', () => {
    expect(cardActionErrorKey({ status: 503, data: { code: 'provider_unavailable' } })).toBe('vendor.customers.cardActions.errors.provider_unavailable')
    expect(cardActionErrorKey({ status: 409, data: { code: 'provider_mismatch' } })).toBe('vendor.customers.cardActions.errors.provider_mismatch')
    expect(cardActionErrorKey({ status: 403, data: { code: 'step_up_required' } })).toBe('vendor.pricing.errors.step_up_required')
  })
})

describe('adminLoginErrorKey', () => {
  it('names the refusals of an address change and leaves every other failure to the shared message', () => {
    expect(adminLoginErrorKey({ status: 409, data: { code: 'admin_login_unchanged' } })).toBe('vendor.customers.adminLogin.errors.admin_login_unchanged')
    expect(adminLoginErrorKey({ status: 409, data: { code: 'workspace_not_activated' } })).toBe('vendor.customers.adminLogin.errors.workspace_not_activated')
    expect(adminLoginErrorKey({ status: 409, data: { code: 'no_workspace' } })).toBe('vendor.customers.adminLogin.errors.no_workspace')
    expect(adminLoginErrorKey({ status: 404, data: { code: 'not_found' } })).toBe('vendor.pricing.errors.not_found')
  })
})

describe('AI top-up refund offer', () => {
  const money = { minor: 2500, exponent: 2, currency: 'SAR' }
  const line = (kind: string, minor = 2500) => ({ key: kind, kind, amount: { ...money, minor } })
  const later = (o: Record<string, unknown> = {}) => ({ status: 'paid', order_id: 'order-1', lines: [line('ai_topup'), line('tax', 375)], adjustments: [] as Adjustment[],
    refund: { refundable: false, first_payment: false, until: '2026-11-20T23:59:59+03:00', window_days: 14, locks_subscription: false }, ...o }) as never
  const inside = new Date('2026-11-20T20:00:00Z'), after = new Date('2026-11-21T00:00:00Z')
  it('is offered for a paid, later, in-window invoice that bought only an AI top-up (tax aside)', () => {
    expect(aiTopupRefundable(later(), inside)).toBe(true)
  })
  it('is withheld otherwise: unpaid, first payment, window over or unknown, mixed lines, no top-up, no order, or any credit note', () => {
    expect(aiTopupRefundable(later({ status: 'issued' }), inside)).toBe(false)
    expect(aiTopupRefundable(later({ refund: { refundable: true, first_payment: true, until: '2026-11-20T23:59:59+03:00', window_days: 14, locks_subscription: false } }), inside)).toBe(false)
    expect(aiTopupRefundable(later(), after)).toBe(false)
    expect(aiTopupRefundable(later({ refund: { refundable: false, first_payment: false, until: null, window_days: 14, locks_subscription: false } }), inside)).toBe(false)
    expect(aiTopupRefundable(later({ lines: [line('ai_topup'), line('base', 9900)] }), inside)).toBe(false)
    expect(aiTopupRefundable(later({ lines: [line('base', 9900)] }), inside)).toBe(false)
    expect(aiTopupRefundable(later({ order_id: null }), inside)).toBe(false)
    for (const status of ['pending', 'refunded']) expect(aiTopupRefundable(later({ adjustments: [{ kind: 'credit_note', origin: 'system', status }] }), inside)).toBe(false)
    expect(aiTopupRefundable(later({ adjustments: [{ kind: 'credit_note', origin: 'vendor', status: 'void' }] }), inside)).toBe(true)
  })
  it('never holds together with an open general refund request', () => {
    for (const first_payment of [true, false]) for (const refundable of [true, false]) for (const open of [true, false]) {
      const invoice = later({ refund: { refundable: refundable && first_payment, first_payment, until: '2026-11-20T23:59:59+03:00', window_days: 14, locks_subscription: false } }) as never
      const topup = aiTopupRefundable(invoice, open ? inside : after)
      const general = refundRequestBlock(invoice) === null
      expect(topup && general, `${first_payment}/${refundable}/${open}`).toBe(false)
    }
  })
})

describe('void of an unpaid renewal invoice', () => {
  const invoice = (o: Record<string, unknown> = {}) => ({ status: 'issued', kind: 'renewal', voidable: true, void_block: null, adjustments: [], ...o }) as Parameters<typeof voidAction>[0]
  it('is available only on a voidable unpaid renewal invoice, for an operator who holds both grants', () => {
    expect(voidAction(invoice(), true)).toEqual({ kind: 'available' })
    expect(voidAction(invoice(), false)).toEqual({ kind: 'hidden' })
  })
  it('names the block the server gives when the invoice cannot be voided now', () => {
    for (const block of ['payment_reconciliation_required', 'transfer_claimed', 'renewal_in_progress', 'lock_pending', 'tenant_retiring'] as const)
      expect(voidAction(invoice({ voidable: false, void_block: block }), true)).toEqual({ kind: 'blocked', block })
  })
  it('is hidden when the server says it does not apply, whatever the status of the invoice', () => {
    expect(voidAction(invoice({ voidable: false }), true)).toEqual({ kind: 'hidden' })
    for (const status of ['draft', 'paid', 'void', 'credit_pending']) expect(voidAction(invoice({ status }), true), status).toEqual({ kind: 'hidden' })
    for (const kind of ['initial', 'change', 'adjustment']) expect(voidAction(invoice({ kind }), true), kind).toEqual({ kind: 'hidden' })
  })
  it('never sits beside a refund: an invoice with any refund note offers no void', () => {
    for (const status of ['pending', 'refunded', 'applied']) expect(voidAction(invoice({ adjustments: [{ kind: 'credit_note', status }] }), true), status).toEqual({ kind: 'hidden' })
    expect(voidAction(invoice({ adjustments: [{ kind: 'credit_note', status: 'void' }] }), true)).toEqual({ kind: 'available' })
  })
  it('needs one of the two outcomes and a reason bounded like the server', () => {
    expect(validVoidDraft({ outcome: 'end', reason: ' Customer left ' })).toBe(true)
    expect(validVoidDraft({ outcome: 'rebill', reason: 'abc' })).toBe(true)
    for (const draft of [{ outcome: '', reason: 'Customer left' }, { outcome: 'waive', reason: 'Customer left' }, { outcome: 'end', reason: 'ab' }, { outcome: 'end', reason: ' a ' }, { outcome: 'end', reason: 'x'.repeat(1001) }])
      expect(validVoidDraft(draft), JSON.stringify(draft)).toBe(false)
  })
  it('words every block and refusal itself, and leaves other codes to the shared mapping', () => {
    for (const code of ['invoice_not_voidable', 'payment_reconciliation_required', 'transfer_claimed', 'renewal_in_progress', 'lock_pending', 'tenant_retiring', 'subscription_suspended', 'subscription_change_pending']) {
      expect(voidReasonKey(code)).toBe(`vendor.invoices.void.reason.${code}`)
      expect(voidErrorKey({ statusCode: 409, data: { code } })).toBe(`vendor.invoices.void.reason.${code}`)
    }
    expect(voidErrorKey({ statusCode: 403, data: { code: 'step_up_required' } })).toBe('vendor.pricing.errors.step_up_required')
    expect(voidErrorKey({ statusCode: 500, data: { code: 'database exploded' } })).toBe('vendor.pricing.errors.generic')
  })
})
