import type { ComputeQuoteInput } from '../commercial/quotes.js'
import type { BundleRevision, PlanRevision, PricingPolicy } from '../commercial/index.js'

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
export const M = { unit: 'month', count: 1 } as const
export const sar = (minor: number) => ({ currency: 'SAR', exponent: 2, minor })
export const policy: PricingPolicy = { id: id(6), timezone: 'Asia/Riyadh', rounding: 'half_up_per_line', tax: { kind: 'vat_exclusive', rate_bps: 1500 } }
export const bundle = (n: number, price: number | null): BundleRevision => ({ id: id(n), bundle_id: id(n + 20), version: 1, edit_revision: 1, name: `b${n}`, description: 'd', audience: { kind: 'public' }, status: 'published', available: true, catalog_release_id: id(1), selections: [], domain_limits: {}, prices: price === null ? [] : [{ cadence: M, amount: sar(price) }] })
export const plan = (over: Partial<PlanRevision> = {}): PlanRevision => ({ id: id(4), plan_id: id(5), version: 1, edit_revision: 1, name: 'Plan', status: 'published', available: true, audience: { kind: 'public' }, term_months: 12, prices: [{ cadence: M, amount: sar(50000) }], platform_limits: { 'users.limit': null, 'storage.limit_mb': null }, included_bundle_revision_ids: [], optional_bundle_revision_ids: [id(2), id(3)], included_extra_branches: 1, extra_branch_prices: [{ cadence: M, amount: sar(50000) }], extra_branches_limit: 8, included_users: 0, included_storage_mb: 0, user_prices: [], storage_prices: [], policy_revision_id: id(6), currency: 'SAR', trial_days: 0, grace_days: 0, auto_suspend: false, auto_renew_allowed: false, ...over })
export const ids = { id: 'q1', customer_id: 'c1', subscription_id: null, expected_subscription_revision: 0 }
export const base = (over: Partial<ComputeQuoteInput> = {}): ComputeQuoteInput => ({ kind: 'new', plan: plan(), bundles: [], terms: null, cadence: M, requested_extra_branches: 3, requested_users: 0, requested_storage_mb: 0, effective_date: '2027-10-01', period: { start: '2027-10-01', end: '2027-11-01' }, policy, ids, expires_at: '2027-10-02T00:00:00Z', ...over })
export const err = (f: () => unknown) => { try { f() } catch (e) { return (e as { code: string }).code } return 'none' }
