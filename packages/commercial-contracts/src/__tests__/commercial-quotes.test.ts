import { describe, expect, it } from 'vitest'
import { computeQuote, type ComputeQuoteInput } from '../commercial/quotes.js'
import { moneySchema, quoteRequestSchema, quoteSchema, planRevisionSchema } from '../commercial/index.js'
import type { BundleRevision, PlanRevision, PricingPolicy } from '../commercial/index.js'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const M = { unit: 'month', count: 1 } as const
const sar = (minor: number) => ({ currency: 'SAR', exponent: 2, minor })
const policy: PricingPolicy = { id: id(6), timezone: 'Asia/Riyadh', rounding: 'half_up_per_line', tax: { kind: 'vat_exclusive', rate_bps: 1500 } }
const bundle = (n: number, price: number | null): BundleRevision => ({ id: id(n), bundle_id: id(n + 20), version: 1, edit_revision: 1, name: `b${n}`, description: 'd', audience: { kind: 'public' }, status: 'published', available: true, catalog_release_id: id(1), selections: [], domain_limits: {}, prices: price === null ? [] : [{ cadence: M, amount: sar(price) }] })
const plan = (over: Partial<PlanRevision> = {}): PlanRevision => ({ id: id(4), plan_id: id(5), version: 1, edit_revision: 1, name: 'Plan', status: 'published', available: true, audience: { kind: 'public' }, term_months: 12, prices: [{ cadence: M, amount: sar(50000) }], platform_limits: {}, included_bundle_revision_ids: [], optional_bundle_revision_ids: [id(2), id(3)], included_extra_branches: 1, extra_branch_prices: [{ cadence: M, amount: sar(50000) }], extra_branches_limit: 8, policy_revision_id: id(6), currency: 'SAR', trial_days: 0, grace_days: 0, auto_suspend: false, auto_renew_allowed: false, ...over })
const ids = { id: 'q1', customer_id: 'c1', subscription_id: null, expected_subscription_revision: 0 }
const base = (over: Partial<ComputeQuoteInput> = {}): ComputeQuoteInput => ({ kind: 'new', plan: plan(), bundles: [], terms: null, cadence: M, requested_extra_branches: 3, effective_date: '2027-10-01', period: { start: '2027-10-01', end: '2027-11-01' }, policy, ids, expires_at: '2027-10-02T00:00:00Z', ...over })
const err = (f: () => unknown) => { try { f() } catch (e) { return (e as { code: string }).code } return 'none' }

describe('computeQuote', () => {
  it('new: 3 extra, 1 free => 2 paid = 100000 + base 50000, VAT separate', () => {
    const q = computeQuote(base({ requested_extra_branches: 3 }))
    const branch = q.lines.find(l => l.kind === 'branch')!
    expect(branch.quantity).toBe(2); expect(branch.amount.minor).toBe(100000)
    expect(q.lines.find(l => l.key === 'tax:now')!.amount.minor).toBe(22500)
    expect(q.due_now.minor).toBe(172500); expect(q.next_renewal.minor).toBe(172500)
    expect(quoteSchema.safeParse({ ...q, entitlement_digest: 'a'.repeat(64) }).success).toBe(true)
  })
  it('HQ free and no branch price needed when none paid', () => {
    const q = computeQuote(base({ requested_extra_branches: 1, plan: plan({ extra_branch_prices: [] }) }))
    expect(q.lines.some(l => l.kind === 'branch')).toBe(false)
    expect(q.due_now.minor).toBe(57500)
  })
  it('zero price is a real price; missing price is an error; terms override isolated', () => {
    const q = computeQuote(base({ requested_extra_branches: 0, bundles: [bundle(2, 0)] }))
    expect(q.due_now.minor).toBe(57500)
    expect(err(() => computeQuote(base({ bundles: [bundle(2, null)] })))).toBe('price_missing')
    const terms = { id: id(9), customer_id: 'c1', reason: 'special', base_price: { cadence: M, amount: sar(0) } }
    const t = computeQuote(base({ requested_extra_branches: 0, terms }))
    expect(t.due_now.minor).toBe(0)
    expect(computeQuote(base({ requested_extra_branches: 0 })).due_now.minor).toBe(57500)
    expect(t.terms_revision_id).toBe(id(9))
  })
  it('errors: currency, branch limit, quantity', () => {
    expect(err(() => computeQuote(base({ plan: plan({ prices: [{ cadence: M, amount: { currency: 'USD', exponent: 2, minor: 1 } }] }) })))).toBe('currency_mismatch')
    expect(err(() => computeQuote(base({ requested_extra_branches: 9 })))).toBe('branch_limit_exceeded')
    expect(err(() => computeQuote(base({ requested_extra_branches: -1 })))).toBe('invalid_quantity')
    expect(err(() => computeQuote(base({ requested_extra_branches: 1.5 })))).toBe('invalid_quantity')
  })
  it('digest is stable and content-sensitive', () => {
    const a = computeQuote(base()), b = computeQuote(base())
    expect(a.digest).toBe(b.digest)
    expect(computeQuote(base({ requested_extra_branches: 4 })).digest).not.toBe(a.digest)
  })
  it('change: added bundle prorated now; downgrade shown at renewal with 0 now', () => {
    const current = { plan_revision_id: id(4), bundle_revision_ids: [id(3)], paid_extra_branches: 0, base_minor: 50000, bundle_minor: { [id(3)]: 10000 }, branch_unit_minor: 50000 }
    const q = computeQuote(base({ kind: 'change', requested_extra_branches: 1, bundles: [bundle(2, 50000)], current, effective_date: '2027-10-17' }))
    const added = q.lines.find(l => l.key === `bundle:${id(2)}:delta`)!
    expect(added.timing).toBe('now'); expect(added.amount.minor).toBe(24194)
    const removed = q.lines.find(l => l.key === `bundle:${id(3)}:delta`)!
    expect(removed.timing).toBe('renewal'); expect(removed.amount.minor).toBe(0)
    expect(q.due_now.minor).toBe(24194 + 3629)
    expect(q.next_renewal.minor).toBe(Math.round(100000 * 1.15))
  })
  it('change: removing paid branches charges nothing now', () => {
    const current = { plan_revision_id: id(4), bundle_revision_ids: [], paid_extra_branches: 3, base_minor: 50000, bundle_minor: {}, branch_unit_minor: 50000 }
    const q = computeQuote(base({ kind: 'change', requested_extra_branches: 1, current, effective_date: '2027-10-17' }))
    expect(q.due_now.minor).toBe(0); expect(q.next_renewal.minor).toBe(57500)
  })
  it('schemas reject bad wire money and caller totals', () => {
    for (const minor of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect(moneySchema.safeParse({ currency: 'SAR', exponent: 2, minor }).success).toBe(false)
    expect(quoteRequestSchema.safeParse({ kind: 'new', plan_revision_id: id(4), bundle_revision_ids: [], cadence: M, requested_extra_branches: 0, due_now: 1 }).success).toBe(false)
    expect(planRevisionSchema.safeParse({ ...plan(), trial_days: undefined }).success).toBe(false)
  })
  it('included bundle is covered by base price: line 0, no price needed; optional still charged', () => {
    const p = plan({ included_bundle_revision_ids: [id(2)], optional_bundle_revision_ids: [id(3)] })
    const q = computeQuote(base({ plan: p, requested_extra_branches: 0, bundles: [bundle(2, 30000), bundle(3, 20000)] }))
    const inc = q.lines.find(l => l.key === `bundle:${id(2)}:included`)!
    expect(inc.amount.minor).toBe(0); expect(inc.quantity).toBe(1)
    expect(q.due_now.minor).toBe(Math.round(70000 * 1.15)); expect(q.next_renewal.minor).toBe(Math.round(70000 * 1.15))
    expect(computeQuote(base({ plan: p, requested_extra_branches: 0, bundles: [bundle(2, null), bundle(3, 20000)] })).due_now.minor).toBe(Math.round(70000 * 1.15))
    const terms = { id: id(9), customer_id: 'c1', reason: 'x', bundle_prices: { [id(2)]: { cadence: M, amount: sar(99999) } } }
    expect(computeQuote(base({ plan: p, requested_extra_branches: 0, bundles: [bundle(2, 30000)], terms })).due_now.minor).toBe(Math.round(50000 * 1.15))
  })
  it('change: adding/removing an included bundle is free', () => {
    const p = plan({ included_bundle_revision_ids: [id(2)], optional_bundle_revision_ids: [] })
    const cur = { plan_revision_id: id(4), bundle_revision_ids: [] as string[], paid_extra_branches: 0, base_minor: 50000, bundle_minor: {}, branch_unit_minor: 50000 }
    const add = computeQuote(base({ kind: 'change', plan: p, requested_extra_branches: 1, bundles: [bundle(2, 30000)], current: cur, effective_date: '2027-10-17' }))
    expect(add.due_now.minor).toBe(0); expect(add.lines.some(l => l.key.startsWith(`bundle:${id(2)}`) && l.timing === 'now')).toBe(false)
    const rem = computeQuote(base({ kind: 'change', plan: p, requested_extra_branches: 1, bundles: [], current: { ...cur, bundle_revision_ids: [id(2)] }, effective_date: '2027-10-17' }))
    expect(rem.due_now.minor).toBe(0); expect(rem.lines.some(l => l.key === `bundle:${id(2)}:delta`)).toBe(false)
  })
})
