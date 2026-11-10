import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { catalogApplicationsFromSolution } from '../commercial/catalog.js'
import { compileEntitlements } from '../commercial/entitlements.js'
import { computeQuote } from '../commercial/quotes.js'
import { AI_ALLOWANCE_MONTHLY_KEY, AI_ALLOWANCE_TRIAL_KEY, AI_BALANCE_GRANTED_KEY, AI_UNITS_MAX, aiBillingSettingsInputSchema, aiBillingSettingsSchema, aiEntitlementFeatures, sarMinorToAiUnits } from '../commercial/ai-topup.js'
import { quoteRequestSchema, quoteSchema } from '../commercial/schemas.js'
import type { CatalogRelease, PlanRevision } from '../commercial/types.js'
import { base, err, M, plan, sar } from './fixtures.js'

const settings = { topup_amounts_minor: [2500, 5000, 10000, 25000, 50000], topup_minimum_minor: 2500, usd_rate: '3.75', trial_allowance_minor: 500, monthly_allowance_minor: 0 }

describe('sarMinorToAiUnits', () => {
  it('is exact and rounds down', () => {
    expect(sarMinorToAiUnits(2500, '3.75')).toBe(666_666) // 6.666... USD
    expect(sarMinorToAiUnits(500, '3.75')).toBe(133_333)
    expect(sarMinorToAiUnits(375, '3.75')).toBe(100_000) // exactly 1 USD
    expect(sarMinorToAiUnits(50000, '3.75')).toBe(13_333_333)
    expect(sarMinorToAiUnits(0, '3.75')).toBe(0)
  })
  it('honours a six-decimal rate without float drift', () => {
    expect(sarMinorToAiUnits(100, '1')).toBe(100_000)
    expect(sarMinorToAiUnits(99, '3.333333')).toBe(Math.floor((99 * 1000 * 1_000_000) / 3_333_333))
    expect(sarMinorToAiUnits(1, '3.75')).toBe(266) // 0.00266 USD
  })
  it('refuses bad input and a total outside the delivered range', () => {
    expect(err(() => sarMinorToAiUnits(-1, '3.75'))).toBe('invalid_quantity')
    expect(err(() => sarMinorToAiUnits(1.5, '3.75'))).toBe('invalid_quantity')
    expect(err(() => sarMinorToAiUnits(100, '0'))).toBe('invalid')
    expect(err(() => sarMinorToAiUnits(100, '3.75e1'))).toBe('invalid')
    expect(err(() => sarMinorToAiUnits(100_000_000, '0.01'))).toBe('ai_balance_limit_exceeded')
  })
})

describe('AI billing settings', () => {
  it('accepts the seed', () => { expect(aiBillingSettingsSchema.safeParse(settings).success).toBe(true) })
  it('refuses unsorted or duplicate amounts, an amount under the minimum, a bad rate and unknown fields', () => {
    expect(aiBillingSettingsSchema.safeParse({ ...settings, topup_amounts_minor: [5000, 2500] }).success).toBe(false)
    expect(aiBillingSettingsSchema.safeParse({ ...settings, topup_amounts_minor: [2500, 2500] }).success).toBe(false)
    expect(aiBillingSettingsSchema.safeParse({ ...settings, topup_amounts_minor: [1000, 2500] }).success).toBe(false)
    expect(aiBillingSettingsSchema.safeParse({ ...settings, topup_amounts_minor: [] }).success).toBe(false)
    expect(aiBillingSettingsSchema.safeParse({ ...settings, usd_rate: 3.75 }).success).toBe(false)
    expect(aiBillingSettingsSchema.safeParse({ ...settings, usd_rate: '0.000000' }).success).toBe(false)
    expect(aiBillingSettingsSchema.safeParse({ ...settings, extra: 1 }).success).toBe(false)
    expect(aiBillingSettingsSchema.safeParse({ ...settings, monthly_allowance_minor: -1 }).success).toBe(false)
  })
  it('the input needs a reason and allows partial fields', () => {
    expect(aiBillingSettingsInputSchema.safeParse({ usd_rate: '3.80', reason: 'Rate change' }).success).toBe(true)
    expect(aiBillingSettingsInputSchema.safeParse({ usd_rate: '3.80' }).success).toBe(false)
  })
})

describe('AI top-up quote line', () => {
  const topup = { amount: sar(25000), units: 6_666_666, usd_rate: '3.75' }
  it('adds one charge-now line, never a renewal line, and is not taxed away from the total', () => {
    const q = computeQuote(base({ requested_extra_branches: 0, ai_topup: topup }))
    const lines = q.lines.filter(l => l.kind === 'ai_topup')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ timing: 'now', quantity: 1, amount: sar(25000), ai_topup: { units: 6_666_666, usd_rate: '3.75' } })
    const without = computeQuote(base({ requested_extra_branches: 0 }))
    expect(q.due_now.minor).toBe(without.due_now.minor + 25000 + 3750)
    expect(q.next_renewal).toEqual(without.next_renewal)
    expect(quoteSchema.safeParse({ ...q, entitlement_digest: 'a'.repeat(64) }).success).toBe(true)
  })
  it('on a change it is never prorated and leaves the renewal untouched', () => {
    const current = { plan_revision_id: plan().id, bundle_revision_ids: [], paid_extra_branches: 0, paid_users: 0, paid_storage_gb: 0, base_minor: 50000, bundle_minor: {}, branch_unit_minor: 0, user_unit_minor: 0, storage_unit_minor: 0 }
    const input = base({ kind: 'change', requested_extra_branches: 0, current, effective_date: '2026-01-16', period: { start: '2026-01-01', end: '2026-02-01' }, ai_topup: topup })
    const q = computeQuote(input)
    expect(q.lines.find(l => l.kind === 'ai_topup')!.amount.minor).toBe(25000)
    expect(q.lines.filter(l => l.timing === 'now' && l.kind !== 'tax' && l.kind !== 'ai_topup')).toHaveLength(0)
    expect(q.due_now.minor).toBe(25000 + 3750)
  })
  it('refuses a currency that is not the plan currency', () => {
    expect(err(() => computeQuote(base({ ai_topup: { amount: { currency: 'USD', exponent: 2, minor: 100 }, units: 1, usd_rate: '3.75' } })))).toBe('currency_mismatch')
  })
  it('the request accepts a positive integer amount only', () => {
    const req = { kind: 'new', plan_revision_id: plan().id, bundle_revision_ids: [], cadence: M, requested_extra_branches: 0, requested_users: 0, requested_storage_mb: 0 }
    expect(quoteRequestSchema.safeParse({ ...req, ai_topup_minor: 2500 }).success).toBe(true)
    expect(quoteRequestSchema.safeParse({ ...req, ai_topup_minor: 0 }).success).toBe(false)
    expect(quoteRequestSchema.safeParse({ ...req, ai_topup_minor: 25.5 }).success).toBe(false)
  })
})

describe('AI entitlement keys', () => {
  it('delivers the three keys and refuses values outside the delivered range', () => {
    expect(aiEntitlementFeatures({ granted_units: 7, trial_units: 3, monthly_units: 0 }))
      .toEqual({ [AI_BALANCE_GRANTED_KEY]: 7, [AI_ALLOWANCE_TRIAL_KEY]: 3, [AI_ALLOWANCE_MONTHLY_KEY]: 0 })
    expect(err(() => aiEntitlementFeatures({ granted_units: AI_UNITS_MAX + 1, trial_units: 0, monthly_units: 0 }))).toBe('ai_balance_limit_exceeded')
    expect(err(() => aiEntitlementFeatures({ granted_units: -1, trial_units: 0, monthly_units: 0 }))).toBe('ai_balance_limit_exceeded')
  })
  const legacy = JSON.parse(readFileSync(new URL('../../../../deploy/catalog/solutions/platform.json', import.meta.url), 'utf8'))
  const solution = { ...legacy, tiers: legacy.tiers.map((t: { id: string }) => (t.id === 'core' ? t : { ...t, sellable: true })) }
  const release: CatalogRelease = { id: '00000000-0000-4000-8000-000000000001', version: 'v1', source_digest: 'a'.repeat(64), artifact_digest: 'b'.repeat(64), applications: catalogApplicationsFromSolution(solution, 'v1') }
  const compile = (platform_limits: PlanRevision['platform_limits'], terms: unknown = null) =>
    compileEntitlements({ release, plan: plan({ platform_limits, optional_bundle_revision_ids: [] }), bundles: [], terms: terms as never, quantities: { users: 5, storage_mb: 0 } })
  it('a plan or terms revision cannot set them, the same refusal as users.limit', () => {
    for (const key of [AI_BALANCE_GRANTED_KEY, AI_ALLOWANCE_TRIAL_KEY, AI_ALLOWANCE_MONTHLY_KEY]) {
      expect(() => compile({ [key]: 1 })).toThrowError(expect.objectContaining({ code: 'platform_limit_derived', field: 'platform_limits' }))
      expect(() => compile({}, { id: '00000000-0000-4000-8000-000000000009', customer_id: 'c', reason: 'terms', limits: { [key]: 1 } }))
        .toThrowError(expect.objectContaining({ code: 'platform_limit_derived', field: 'limits' }))
    }
  })
})
