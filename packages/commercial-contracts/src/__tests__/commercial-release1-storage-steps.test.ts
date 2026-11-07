import { describe, expect, it } from 'vitest'
import { computeQuote, fitsStorageSteps } from '../commercial/quotes.js'
import { base, err, M, plan, policy, sar } from './fixtures.js'

/**
 * A11 (owner decision 2026-11-07): extra storage is bought in steps of 10 GiB up to 100 GiB, then 100 GiB at a time.
 * The steps are plan values, so a vendor can change them; these tests use the seeded ones.
 */
const STEPS = { storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400 }
const GB = 1024
// 20 GiB included, so an extra of n GiB is requested_storage_mb = (20 + n) GiB.
const included = 20
const metered = plan({ included_storage_mb: included * GB, storage_prices: [{ cadence: M, amount: sar(100) }], ...STEPS })
// The shared fixture policy charges 15% VAT; these tests are about steps and use the net amount.
const net = (q: { due_now: { minor: number } }) => Math.round(q.due_now.minor / 1.15)
const quoteExtra = (extraGb: number) => base({ plan: metered, requested_extra_branches: 0, requested_users: 0, requested_storage_mb: (included + extraGb) * GB })

describe('storage purchase steps', () => {
  it('accepts the small steps below the threshold', () => {
    for (const extra of [10, 20, 90, 100]) expect(fitsStorageSteps(extra * GB, STEPS), String(extra)).toBe(true)
  })

  it('refuses anything that is not a whole step', () => {
    for (const extra of [1, 5, 25, 110, 150]) expect(fitsStorageSteps(extra * GB, STEPS), String(extra)).toBe(false)
  })

  it('accepts the large steps from the threshold upward, and zero always', () => {
    expect(fitsStorageSteps(0, STEPS)).toBe(true)
    for (const extra of [100, 200, 300]) expect(fitsStorageSteps(extra * GB, STEPS), String(extra)).toBe(true)
  })

  it('quotes 0, 10, 100 and 200 GiB of extra and refuses 110 with a structured code', () => {
    expect(net(computeQuote(quoteExtra(0)))).toBe(50000)
    expect(net(computeQuote(quoteExtra(10)))).toBe(50000 + 1000)
    expect(net(computeQuote(quoteExtra(100)))).toBe(50000 + 10000)
    expect(net(computeQuote(quoteExtra(200)))).toBe(50000 + 20000)
    // 110 GiB is a whole number of gigabytes, so it passes the gigabyte rule, and is refused by the step rule.
    expect(err(() => computeQuote(quoteExtra(110)))).toBe('storage_step_invalid')
  })

  it('refuses a negative or fractional amount through the existing quantity rule', () => {
    expect(err(() => computeQuote(base({ plan: metered, requested_extra_branches: 0, requested_storage_mb: -1024 })))).toBe('invalid_quantity')
    expect(err(() => computeQuote(base({ plan: metered, requested_extra_branches: 0, requested_storage_mb: included * GB + 512 })))).toBe('invalid_quantity')
  })

  it('charges the annual quote in whole steps too', () => {
    const yearly = base({ plan: { ...metered, prices: [{ cadence: { unit: 'year', count: 1 }, amount: sar(500000) }], storage_prices: [{ cadence: { unit: 'year', count: 1 }, amount: sar(1000) }] },
      cadence: { unit: 'year', count: 1 }, requested_extra_branches: 0, requested_users: 0, requested_storage_mb: (included + 10) * GB,
      period: { start: '2027-10-01', end: '2028-10-01' } })
    expect(net(computeQuote(yearly))).toBe(500000 + 10000)
    expect(err(() => computeQuote({ ...yearly, requested_storage_mb: (included + 110) * GB }))).toBe('storage_step_invalid')
  })

  it('follows the plan values, not a hardcoded step', () => {
    // A vendor sets 50 GiB steps below 200 GiB, then 200 GiB: 50 is legal there and 10 is not.
    const custom = plan({ included_storage_mb: 0, storage_prices: [{ cadence: M, amount: sar(100) }], storage_step_mb: 50 * GB, storage_step_threshold_mb: 200 * GB, storage_large_step_mb: 200 * GB })
    const q = (gb: number) => base({ plan: custom, requested_extra_branches: 0, requested_users: 0, requested_storage_mb: gb * GB })
    expect(err(() => computeQuote(q(50)))).toBe('none')
    expect(err(() => computeQuote(q(10)))).toBe('storage_step_invalid')
    expect(err(() => computeQuote(q(200)))).toBe('none')
    expect(err(() => computeQuote(q(250)))).toBe('storage_step_invalid')
    void policy
  })
})
