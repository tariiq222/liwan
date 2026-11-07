import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { invoiceSchema, TAX_LABELS } from '../commercial/billing.js'
import { computeQuote } from '../commercial/quotes.js'
import type { PlanRevision, PricingPolicy } from '../commercial/types.js'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const sar = (minor: number) => ({ currency: 'SAR', exponent: 2, minor })
const monthly = { unit: 'month' as const, count: 1 }

/** Liwan is not VAT-registered (owner decision 2026-11-06): the release's one active policy charges no tax. */
const NO_TAX: PricingPolicy = { id: id(6), timezone: 'Asia/Riyadh', rounding: 'half_up_per_line', tax: { kind: 'none' } }
/** The mechanism for the day Liwan registers, kept and tested; not the default and not active. */
const FUTURE_VAT: PricingPolicy = { id: id(7), timezone: 'Asia/Riyadh', rounding: 'half_up_per_line', tax: { kind: 'vat_exclusive', rate_bps: 1500 } }

const plan: PlanRevision = { id: id(4), plan_id: id(5), version: 1, edit_revision: 1, name: 'LiwanOS', status: 'published', available: true,
  audience: { kind: 'public' }, term_months: 12, prices: [{ cadence: monthly, amount: sar(9900) }], platform_limits: {},
  included_bundle_revision_ids: [], optional_bundle_revision_ids: [], included_extra_branches: 0, extra_branch_prices: [],
  extra_branches_limit: null, included_users: 3, included_storage_mb: 5120,
  storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400,
  user_prices: [{ cadence: monthly, amount: sar(2900) }], storage_prices: [{ cadence: monthly, amount: sar(100) }],
  policy_revision_id: id(6), currency: 'SAR', trial_days: 14, grace_days: 7, auto_suspend: true, auto_renew_allowed: true }

function quote(policy: PricingPolicy, bundleMonthly = 0) {
  const bundles = bundleMonthly > 0 ? [{ id: id(20), bundle_id: id(40), version: 1, edit_revision: 1, name: 'CRM',
    description: 'crm', audience: { kind: 'public' as const }, status: 'published' as const, available: true, catalog_release_id: id(1),
    selections: [{ app_id: 'crm', feature_keys: [] }], domain_limits: {}, prices: [{ cadence: monthly, amount: sar(bundleMonthly) }] }] : []
  return computeQuote({ kind: 'new', plan, bundles, terms: null, cadence: monthly, requested_extra_branches: 0, requested_users: 3,
    requested_storage_mb: 5120, effective_date: '2026-11-06', period: { start: '2026-11-06', end: '2026-12-06' }, policy,
    ids: { id: id(30), customer_id: id(31), subscription_id: null, expected_subscription_revision: 0 },
    expires_at: '2026-11-06T12:00:00.000Z', entitlement_digest: 'a'.repeat(64) })
}

describe('Liwan\'s own invoices carry no tax', () => {
  it('adds no tax line and totals equal the subtotal under the no-tax policy', () => {
    const q = quote(NO_TAX, 9900)
    expect(q.lines.some(line => line.kind === 'tax')).toBe(false)
    expect(q.due_now.minor).toBe(19800)
    const subtotal = q.lines.filter(line => line.timing === 'now').reduce((sum, line) => sum + line.amount.minor, 0)
    expect(subtotal).toBe(q.due_now.minor)
    expect(q.lines.some(line => /vat|ضريبة/i.test(line.description))).toBe(false)
  })

  it('prints no tax wording on the invoice document under the no-tax policy', () => {
    const lines = [
      { key: 'base', kind: 'base' as const, timing: 'now' as const, description: 'LiwanOS', quantity: 1, unit_amount: sar(9900), amount: sar(9900), period_start: '2026-11-06', period_end: '2026-12-06', source_revision_id: id(4) },
    ]
    const document = { id: 'inv', number: 'INV-1', customer_id: id(31), subscription_id: id(32), order_id: 'o', kind: 'initial' as const,
      status: 'issued' as const, currency: 'SAR', lines, subtotal: sar(9900), tax: sar(0), total: sar(9900),
      period_start: '2026-11-06', period_end: '2026-12-06', issued_at: 'x', due_at: null, paid_at: null,
      tax_label: null, official_tax_invoice: false }
    const parsed = invoiceSchema.parse(document)
    expect(parsed.tax_label).toBeNull()
    const rendered = JSON.stringify(parsed)
    for (const wording of ['VAT', 'ضريبة', '15%', '15٪', 'ZATCA', 'زاتكا']) expect(rendered).not.toContain(wording)
    // A tax label is only ever the value the policy names, and the schema takes none here.
    expect(invoiceSchema.safeParse({ ...document, tax_label: 'VAT 15% exclusive' }).success).toBe(false)
  })
})

describe('the VAT mechanism stays ready for the day Liwan registers', () => {
  it('adds one labelled tax line and a total that includes it under the 15% policy', () => {
    const q = quote(FUTURE_VAT, 9900)
    // One tax line for the period now due and one for the renewal preview; the invoice carries the former.
    const taxes = q.lines.filter(line => line.kind === 'tax' && line.timing === 'now')
    expect(taxes).toHaveLength(1)
    expect(taxes[0]!.amount.minor).toBe(2970) // 198.00 * 15%
    expect(q.due_now.minor).toBe(22770)
    const document = { id: 'inv', number: 'INV-2', customer_id: id(31), subscription_id: id(32), order_id: 'o', kind: 'initial' as const,
      status: 'issued' as const, currency: 'SAR',
      lines: q.lines.filter(line => line.timing === 'now').map(line => ({ ...line, unit_amount: line.amount })),
      subtotal: sar(19800), tax: sar(2970),
      total: sar(22770), period_start: '2026-11-06', period_end: '2026-12-06', issued_at: 'x', due_at: null, paid_at: null,
      tax_label: TAX_LABELS.vat_exclusive, official_tax_invoice: false }
    const parsed = invoiceSchema.parse(document)
    expect(parsed.tax_label).toBe('VAT 15% exclusive')
    expect(parsed.tax.minor).toBe(2970)
  })
})

describe('no Liwan billing surface names VAT or ZATCA by default', () => {
  const read = (path: string) => readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8')
  it('pins the seeded plan to the no-tax policy, never to the 15% one', () => {
    const plan = read('apps/control-plane/src/schema_025.sql')
    // The plan seed names exactly one policy revision, and it is the no-tax one.
    const policyIds = new Set(plan.match(/6f1c3d8e-0000-4000-8000-00000000000[12]/g) ?? [])
    expect([...policyIds]).toEqual(['6f1c3d8e-0000-4000-8000-000000000002'])
  })
})
