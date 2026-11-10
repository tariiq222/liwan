import { describe, expect, it } from 'vitest'
import { computeQuote } from '../commercial/quotes.js'
import { addCadence, daysBetween, riyadhDate } from '../commercial/calendar.js'
import { moneySchema, quoteRequestSchema, quoteSchema, planRevisionSchema } from '../commercial/index.js'
import { base, bundle, err, id, M, plan, sar } from './fixtures.js'

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
    const current = { plan_revision_id: id(4), bundle_revision_ids: [id(3)], paid_extra_branches: 0, base_minor: 50000, bundle_minor: { [id(3)]: 10000 }, branch_unit_minor: 50000, paid_users: 0, paid_storage_gb: 0, user_unit_minor: 0, storage_unit_minor: 0 }
    const q = computeQuote(base({ kind: 'change', requested_extra_branches: 1, bundles: [bundle(2, 50000)], current, effective_date: '2027-10-17' }))
    const added = q.lines.find(l => l.key === `bundle:${id(2)}:delta`)!
    expect(added.timing).toBe('now'); expect(added.amount.minor).toBe(24194)
    const removed = q.lines.find(l => l.key === `bundle:${id(3)}:delta`)!
    expect(removed.timing).toBe('renewal'); expect(removed.amount.minor).toBe(0)
    expect(q.due_now.minor).toBe(24194 + 3629)
    expect(q.next_renewal.minor).toBe(Math.round(100000 * 1.15))
  })
  it('change: removing paid branches charges nothing now', () => {
    const current = { plan_revision_id: id(4), bundle_revision_ids: [], paid_extra_branches: 3, base_minor: 50000, bundle_minor: {}, branch_unit_minor: 50000, paid_users: 0, paid_storage_gb: 0, user_unit_minor: 0, storage_unit_minor: 0 }
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
    const cur = { plan_revision_id: id(4), bundle_revision_ids: [] as string[], paid_extra_branches: 0, base_minor: 50000, bundle_minor: {}, branch_unit_minor: 50000, paid_users: 0, paid_storage_gb: 0, user_unit_minor: 0, storage_unit_minor: 0 }
    const add = computeQuote(base({ kind: 'change', plan: p, requested_extra_branches: 1, bundles: [bundle(2, 30000)], current: cur, effective_date: '2027-10-17' }))
    expect(add.due_now.minor).toBe(0); expect(add.lines.some(l => l.key.startsWith(`bundle:${id(2)}`) && l.timing === 'now')).toBe(false)
    const rem = computeQuote(base({ kind: 'change', plan: p, requested_extra_branches: 1, bundles: [], current: { ...cur, bundle_revision_ids: [id(2)] }, effective_date: '2027-10-17' }))
    expect(rem.due_now.minor).toBe(0); expect(rem.lines.some(l => l.key === `bundle:${id(2)}:delta`)).toBe(false)
  })
})

describe('computeQuote metered lines', () => {
  // Storage steps from the fixture plan: 10 GiB below 100 GiB of extra storage, 100 GiB at or above it (A11).
  const metered = plan({ included_users: 3, included_storage_mb: 5120, user_prices: [{ cadence: M, amount: sar(2500) }], storage_prices: [{ cadence: M, amount: sar(500) }] })
  it('adds one users line and one storage line to a new quote', () => {
    // +20 GiB above the 5 GiB minimum: a whole number of the 10 GiB small step.
    const q = computeQuote(base({ plan: metered, requested_extra_branches: 1, requested_users: 10, requested_storage_mb: 25600 }))
    expect(q.lines.filter(l => l.kind === 'users')).toHaveLength(1)
    expect(q.lines.find(l => l.kind === 'users')!.quantity).toBe(7)
    expect(q.lines.find(l => l.kind === 'users')!.amount.minor).toBe(7 * 2500)
    expect(q.lines.find(l => l.kind === 'storage')!.quantity).toBe(20)
    expect(q.lines.find(l => l.kind === 'storage')!.amount.minor).toBe(20 * 500)
    expect(q.due_now.minor).toBe(Math.round((50000 + 17500 + 10000) * 1.15))
    expect(q.requested_users).toBe(10); expect(q.requested_storage_mb).toBe(25600)
  })
  it('omits the line entirely at the included minimum', () => {
    const q = computeQuote(base({ plan: metered, requested_extra_branches: 1, requested_users: 3, requested_storage_mb: 5120 }))
    expect(q.lines.some(l => l.kind === 'users' || l.kind === 'storage')).toBe(false)
  })
  it('charges the base price, never a negative line, below the included minimum', () => {
    const q = computeQuote(base({ plan: metered, requested_extra_branches: 1, requested_users: 1, requested_storage_mb: 1024 }))
    expect(q.lines.some(l => l.kind === 'users' || l.kind === 'storage')).toBe(false)
    expect(q.due_now.minor).toBe(Math.round(50000 * 1.15))
  })
  it('refuses a paid quantity with no unit price', () => {
    expect(err(() => computeQuote(base({ plan: plan({ included_users: 3, user_prices: [] }), requested_users: 10 })))).toBe('price_missing')
    expect(err(() => computeQuote(base({ plan: plan({ included_storage_mb: 1024, storage_prices: [] }), requested_storage_mb: 11264 })))).toBe('price_missing')
  })
  it('refuses a storage increment that is not a whole gigabyte', () => {
    expect(err(() => computeQuote(base({ plan: metered, requested_extra_branches: 1, requested_storage_mb: 5632 })))).toBe('invalid_quantity')
  })
  it('prorates a mid-period increase in users and storage', () => {
    const current = { plan_revision_id: id(4), bundle_revision_ids: [], paid_extra_branches: 0, base_minor: 50000, bundle_minor: {}, branch_unit_minor: 50000,
      paid_users: 0, paid_storage_gb: 0, user_unit_minor: 2500, storage_unit_minor: 500 }
    const q = computeQuote(base({ kind: 'change', plan: metered, requested_extra_branches: 1, requested_users: 10, requested_storage_mb: 25600, current, effective_date: '2027-10-17' }))
    expect(q.lines.find(l => l.kind === 'users' && l.timing === 'now')!.amount.minor).toBe(8468)
    // 20 GiB x 500 = 10 000 prorated over the 15 of 31 days left: round-half-up(10000*15/31) = 4839.
    expect(q.lines.find(l => l.kind === 'storage' && l.timing === 'now')!.amount.minor).toBe(4839)
    expect(q.next_renewal.minor).toBe(Math.round((50000 + 17500 + 10000) * 1.15))
  })
})

describe('computeQuote during a trial (L6)', () => {
  // A 14-day trial 2026-10-25 -> 2026-11-08. The cycle that follows it is 30 days monthly (11-08 -> 12-08)
  // and 365 days yearly (2026-11-08 -> 2027-11-08): the daily rate inside the trial is the rate after it.
  const Y = { unit: 'year', count: 1 } as const
  const trialPlan = plan({ included_users: 3, prices: [{ cadence: M, amount: sar(50000) }, { cadence: Y, amount: sar(600000) }],
    user_prices: [{ cadence: M, amount: sar(10000) }, { cadence: Y, amount: sar(120000) }] })
  const current = { plan_revision_id: id(4), bundle_revision_ids: [] as string[], paid_extra_branches: 0, base_minor: 50000, bundle_minor: {}, branch_unit_minor: 50000,
    paid_users: 0, paid_storage_gb: 0, user_unit_minor: 0, storage_unit_minor: 0 }
  const period = { start: '2026-10-25', end: '2026-11-08' }
  const buy = (cadence: typeof M | typeof Y, effective_date: string, proration_cycle_days?: number) =>
    computeQuote(base({ kind: 'change', plan: trialPlan, cadence, requested_extra_branches: 1, requested_users: 5, current, effective_date, period, proration_cycle_days }))
  const userDelta = (q: ReturnType<typeof buy>) => q.lines.find(l => l.key === 'users:delta')!.amount.minor

  it('monthly: the added delta is days left over the 30-day cycle that follows the trial', () => {
    const cases: [string, number][] = [['2026-10-25', 9333], ['2026-10-26', 8667], ['2026-11-01', 4667], ['2026-11-07', 667]]
    for (const [day, minor] of cases) {
      const q = buy(M, day, 30)
      expect(userDelta(q)).toBe(minor)
      expect(q.due_now.minor).toBe(minor + Math.round(minor * 0.15))
    }
  })
  it('annual: the added delta is days left over the 365-day cycle that follows the trial', () => {
    const cases: [string, number][] = [['2026-10-25', 9205], ['2026-10-26', 8548], ['2026-11-01', 4603], ['2026-11-07', 658]]
    for (const [day, minor] of cases) expect(userDelta(buy(Y, day, 365))).toBe(minor)
  })
  it('without the input a trial delta is pro-rated over the trial length, as before', () => {
    expect(userDelta(buy(M, '2026-10-26'))).toBe(18571)
    expect(userDelta(buy(M, '2026-10-26', 14))).toBe(18571)
  })
  it('an input equal to the period length leaves the quote byte-identical', () => {
    expect(buy(M, '2026-10-26', 14).digest).toBe(buy(M, '2026-10-26').digest)
  })
  // The control plane derives the cycle from trial_ends_at: Riyadh date of the instant, then the cadence cycle from it.
  const cycleAfter = (trialEndsAt: string, cadence: typeof M | typeof Y) => { const end = riyadhDate(trialEndsAt); return daysBetween(end, addCadence(end, cadence, 1)) }
  const quoteTrial = (cadence: typeof M | typeof Y, end: string, effective_date: string, cycle: number) =>
    computeQuote(base({ kind: 'change', plan: trialPlan, cadence, requested_extra_branches: 1, requested_users: 5, current, effective_date,
      period: { start: '2026-01-01', end }, proration_cycle_days: cycle }))

  it('a trial longer than the cycle after it prices the days left at the same daily rate', () => {
    // [days left, cycle, expected] for a 20000 monthly delta: round-half-up(20000 * left / cycle)
    const cases: [string, number, number][] = [['2026-10-25', 30, 26667], ['2026-10-10', 30, 36667], ['2026-10-18', 28, 33571], ['2026-11-03', 28, 22143], ['2026-09-05', 30, 60000], ['2026-10-04', 30, 40667]]
    for (const [day, cycle, minor] of cases)
      expect(userDelta(quoteTrial(M, '2026-12-04', day, cycle))).toBe(minor)
  })
  it('the trial end is the Riyadh calendar day of trial_ends_at, even when UTC is still the day before', () => {
    // 21:30 UTC is 00:30 the next day in Riyadh (UTC+3).
    expect(riyadhDate('2026-11-08T21:30:00Z')).toBe('2026-11-09')
    expect(cycleAfter('2026-11-08T21:30:00Z', M)).toBe(30) // 2026-11-09 -> 2026-12-09
    expect(cycleAfter('2026-11-08T20:59:00Z', M)).toBe(30) // 2026-11-08 -> 2026-12-08
    expect(cycleAfter('2027-01-31T21:30:00Z', M)).toBe(28) // 2027-02-01 -> 2027-03-01
    // A quote at 23:30 UTC on 2026-11-07 is already 2026-11-08 in Riyadh: the trial ends today, nothing remains.
    const today = riyadhDate('2026-11-07T23:30:00Z')
    expect(today).toBe('2026-11-08')
    const q = quoteTrial(M, riyadhDate('2026-11-08T09:00:00Z'), today, 30)
    expect(userDelta(q)).toBe(0)
  })
  it('on the last day (trial ends today) the delta is 0 and nothing is negative', () => {
    const q = quoteTrial(M, '2026-11-08', '2026-11-08', 30)
    expect(userDelta(q)).toBe(0)
    expect(q.lines.every(l => l.amount.minor >= 0)).toBe(true)
    expect(q.due_now.minor).toBe(0)
  })
  it('a 28-day February cycle after the trial', () => {
    expect(cycleAfter('2027-02-01T09:00:00Z', M)).toBe(28)
    // 14 of 28 days left: half of the 20000 monthly delta.
    expect(userDelta(quoteTrial(M, '2027-02-01', '2027-01-18', 28))).toBe(10000)
    expect(userDelta(quoteTrial(M, '2027-02-01', '2027-01-25', 28))).toBe(5000)
  })
  it('an annual cycle that contains 29 February is 366 days', () => {
    expect(cycleAfter('2027-11-08T09:00:00Z', Y)).toBe(366) // 2027-11-08 -> 2028-11-08
    expect(cycleAfter('2026-11-08T09:00:00Z', Y)).toBe(365)
    // 240000 * 14 / 366 = 9180.33, * 7 / 366 = 4590.16
    expect(userDelta(quoteTrial(Y, '2027-11-08', '2027-10-25', 366))).toBe(9180)
    expect(userDelta(quoteTrial(Y, '2027-11-08', '2027-11-01', 366))).toBe(4590)
  })
  it('keeps the renewal side untouched', () => {
    const q = buy(M, '2026-10-26', 30)
    expect(q.next_renewal_at).toBe('2026-11-08')
    expect(q.next_renewal.minor).toBe(buy(M, '2026-10-26').next_renewal.minor)
  })
  it('refuses a cycle length that is not a positive whole number of days', () => {
    for (const bad of [0, -1, 1.5]) expect(err(() => buy(M, '2026-10-26', bad))).toBe('invalid_billing_period')
  })
  it('still refuses an effective date past the trial period end', () => {
    expect(err(() => buy(M, '2026-11-09', 30))).toBe('invalid_billing_period')
  })
})

it('prices only unpaid unit-days in the first cycle after early conversion (L4)', () => {
  const metered = plan({ included_users: 3, user_prices: [{ cadence: M, amount: sar(3100) }] })
  const q = computeQuote(base({
    plan: metered, requested_extra_branches: 1, requested_users: 6,
    period: { start: '2027-10-01', end: '2027-11-01' }, effective_date: '2027-10-01',
    paid_through: { users: [{ quantity: 1, through: '2027-10-11' }, { quantity: 1, through: '2027-10-21' }] },
  }))
  expect(q.lines.find(l => l.key === 'base')?.amount.minor).toBe(50000)
  expect(q.lines.find(l => l.key === 'users')?.amount.minor).toBe(6300)
  expect(q.due_now.minor).toBe(64745)
  expect(q.next_renewal.minor).toBe(68195)
})
