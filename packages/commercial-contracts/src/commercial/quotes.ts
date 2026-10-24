import { createHash } from 'node:crypto'
import { addCadence, canonicalJson, daysBetween, remainingDays } from './calendar.js'
import { paidExtraBranches, paidStorageGb, paidUnits, prorateMinor, vat } from './pricing.js'
import { CommercialError } from './types.js'
import type { BundleRevision, Cadence, CustomerTermsRevision, Money, PlanRevision, Price, PricingPolicy, Quote, QuoteLine } from './types.js'

export type QuoteCurrent = {
  plan_revision_id: string; bundle_revision_ids: string[]; paid_extra_branches: number
  paid_users: number; paid_storage_gb: number
  base_minor: number; bundle_minor: Record<string, number>; branch_unit_minor: number
  user_unit_minor: number; storage_unit_minor: number
}
export type QuoteIds = { id: string; customer_id: string; subscription_id: string | null; expected_subscription_revision: number }
export type ComputeQuoteInput = {
  kind: 'new' | 'change'; plan: PlanRevision; bundles: BundleRevision[]; terms: CustomerTermsRevision | null
  cadence: Cadence; requested_extra_branches: number; requested_users: number; requested_storage_mb: number; current?: QuoteCurrent
  effective_date: string; period: { start: string; end: string }; policy: PricingPolicy
  ids: QuoteIds; expires_at: string; entitlement_digest?: string
}

const same = (a: Cadence, b: Cadence) => a.unit === b.unit && a.count === b.count
function pick(cadence: Cadence, currency: string, ...sources: (Price[] | Price | undefined)[]): Price | undefined {
  for (const s of sources) {
    if (s === undefined) continue
    const list = Array.isArray(s) ? s : [s]
    const hit = list.find(p => same(p.cadence, cadence))
    if (hit) {
      if (hit.amount.currency !== currency) throw new CommercialError('currency_mismatch')
      return hit
    }
  }
  return undefined
}

export function computeQuote(input: ComputeQuoteInput): Quote {
  const { kind, plan, bundles, terms, cadence, policy, ids, period } = input
  const currency = plan.currency
  const included = terms?.included_extra_branches ?? plan.included_extra_branches
  const limit = terms?.extra_branches_limit !== undefined ? terms.extra_branches_limit : plan.extra_branches_limit
  const requested = input.requested_extra_branches
  const paid = paidExtraBranches(requested, included)
  const paidUsers = paidUnits(input.requested_users, plan.included_users)
  const paidStorage = paidStorageGb(input.requested_storage_mb, plan.included_storage_mb)
  if (limit !== null && requested > limit) throw new CommercialError('branch_limit_exceeded', 'requested_extra_branches')
  if (kind === 'change' && !input.current) throw new CommercialError('invalid_quantity', 'current')

  const exponents = new Set<number>()
  const price = (what: string, p: Price | undefined): Money => {
    if (!p) throw new CommercialError('price_missing', what)
    exponents.add(p.amount.exponent)
    return p.amount
  }
  const base = price('base', pick(cadence, currency, terms?.base_price, plan.prices))
  // Included bundles are covered by the base price: no price lookup, zero amount. Customer-terms
  // bundle_prices only override OPTIONAL bundles.
  const includedIds = new Set(plan.included_bundle_revision_ids)
  const isIncluded = (id: string) => includedIds.has(id)
  const bundleAmounts = bundles.map(b => ({ b, included: isIncluded(b.id), amount: isIncluded(b.id) ? { currency, exponent: base.exponent, minor: 0 } : price(`bundle:${b.id}`, pick(cadence, currency, terms?.bundle_prices?.[b.id], b.prices)) }))
  const branchAmount = pick(cadence, currency, terms?.extra_branch_price, plan.extra_branch_prices)
  if (paid > 0) price('branch', branchAmount)
  const userAmount = pick(cadence, currency, plan.user_prices)
  const storageAmount = pick(cadence, currency, plan.storage_prices)
  if (paidUsers > 0) price('users', userAmount)
  if (paidStorage > 0) price('storage', storageAmount)
  const exponent = base.exponent
  if ([...exponents].some(e => e !== exponent)) throw new CommercialError('currency_mismatch')
  const money = (minor: number): Money => ({ currency, exponent, minor })

  const cycleDays = daysBetween(period.start, period.end)
  const remaining = kind === 'change' ? remainingDays(input.effective_date, period.end) : cycleDays
  if (cycleDays < 1 || remaining > cycleDays) throw new CommercialError('invalid_billing_period')
  const sourceId = (id: string) => id
  const lines: QuoteLine[] = []
  const nextPeriodEnd = addCadence(period.end, cadence, 1)
  let dueNow = 0, renewal = 0
  const taxRate = policy.tax.kind === 'vat_exclusive' ? policy.tax.rate_bps : 0

  const add = (key: string, kind_: QuoteLine['kind'], description: string, quantity: number, minor: number, timing: 'now' | 'renewal', src: string, start: string, end: string) => {
    lines.push({ key, kind: kind_, timing, description, quantity, amount: money(minor), period_start: start, period_end: end, source_revision_id: sourceId(src) })
  }
  const unit = branchAmount?.amount.minor ?? 0
  const userUnit = userAmount?.amount.minor ?? 0
  const storageUnit = storageAmount?.amount.minor ?? 0

  // next renewal: full target cycle
  const renewalLines: [string, QuoteLine['kind'], string, number, number, string][] = [
    ['base', 'base', plan.name, 1, base.minor, plan.id],
    ...bundleAmounts.map(({ b, amount, included }) => [included ? `bundle:${b.id}:included` : `bundle:${b.id}`, 'bundle', included ? `${b.name} (included)` : b.name, 1, amount.minor, b.id] as [string, QuoteLine['kind'], string, number, number, string]),
  ]
  if (paid > 0) renewalLines.push(['branch', 'branch', 'Extra branches', paid, unit * paid, plan.id])
  if (paidUsers > 0) renewalLines.push(['users', 'users', 'Users', paidUsers, userUnit * paidUsers, plan.id])
  if (paidStorage > 0) renewalLines.push(['storage', 'storage', 'Storage', paidStorage, storageUnit * paidStorage, plan.id])
  for (const amount of [unit * paid, userUnit * paidUsers, storageUnit * paidStorage])
    if (!Number.isSafeInteger(amount)) throw new CommercialError('invalid_quantity')
  for (const [k, kd, d, q, m, s] of renewalLines) {
    renewal += m
    if (kind === 'new') add(k, kd, d, q, m, 'now', s, period.start, period.end)
    else add(k, kd, d, q, m, 'renewal', s, period.end, nextPeriodEnd)
  }

  if (kind === 'new') {
    dueNow = renewal
  } else {
    const cur = input.current as QuoteCurrent
    const prorated = (m: number) => prorateMinor({ cycleMinor: m, remainingDays: remaining, cycleDays })
    const pushDelta = (k: string, kd: QuoteLine['kind'], d: string, q: number, delta: number, src: string, targetMinor: number) => {
      if (delta > 0) {
        const p = prorated(delta); dueNow += p
        add(`${k}:delta`, kd, d, q, p, 'now', src, input.effective_date, period.end)
      } else if (delta < 0 && targetMinor >= 0) {
        add(`${k}:delta`, kd, d, q, 0, 'renewal', src, period.end, nextPeriodEnd)
      }
    }
    const planChanged = cur.plan_revision_id !== plan.id
    const baseDelta = base.minor - cur.base_minor
    if (planChanged || baseDelta !== 0) pushDelta('base', 'base', plan.name, 1, baseDelta, plan.id, base.minor)
    const curSet = new Set(cur.bundle_revision_ids)
    for (const { b, amount, included } of bundleAmounts) if (!included && !curSet.has(b.id)) pushDelta(`bundle:${b.id}`, 'bundle', b.name, 1, amount.minor, b.id, amount.minor)
    const targetIds = new Set(bundles.map(b => b.id))
    for (const id of curSet) if (!targetIds.has(id) && !isIncluded(id)) {
      pushDelta(`bundle:${id}`, 'bundle', id, 1, -(cur.bundle_minor[id] ?? 0), id, 0)
    }
    const branchDelta = paid - cur.paid_extra_branches
    if (branchDelta > 0) pushDelta('branch', 'branch', 'Extra branches', branchDelta, unit * branchDelta, plan.id, unit)
    else if (branchDelta < 0) pushDelta('branch', 'branch', 'Extra branches', -branchDelta, -(cur.branch_unit_minor * -branchDelta), plan.id, 0)
    const userDelta = paidUsers - cur.paid_users
    if (userDelta > 0) pushDelta('users', 'users', 'Users', userDelta, userUnit * userDelta, plan.id, userUnit)
    else if (userDelta < 0) pushDelta('users', 'users', 'Users', -userDelta, -(cur.user_unit_minor * -userDelta), plan.id, 0)
    const storageDelta = paidStorage - cur.paid_storage_gb
    if (storageDelta > 0) pushDelta('storage', 'storage', 'Storage', storageDelta, storageUnit * storageDelta, plan.id, storageUnit)
    else if (storageDelta < 0) pushDelta('storage', 'storage', 'Storage', -storageDelta, -(cur.storage_unit_minor * -storageDelta), plan.id, 0)
  }

  const tax = (base_: number, key: string, timing: 'now' | 'renewal', start: string, end: string) => {
    const t = vat(base_, taxRate)
    if (policy.tax.kind === 'vat_exclusive') add(key, 'tax', 'VAT', 1, t, timing, policy.id, start, end)
    return t
  }
  const dueTax = tax(dueNow, 'tax:now', 'now', kind === 'new' ? period.start : input.effective_date, period.end)
  const renewTax = tax(renewal, 'tax:renewal', 'renewal', period.end, nextPeriodEnd)

  const body = {
    kind, plan_revision_id: plan.id, bundle_revision_ids: bundles.map(b => b.id).sort(), terms_revision_id: terms?.id ?? null,
    entitlement_digest: input.entitlement_digest ?? '', requested_extra_branches: requested,
    requested_users: input.requested_users, requested_storage_mb: input.requested_storage_mb, cadence,
    effective_date: input.effective_date, policy_revision_id: policy.id, lines, due_now: money(dueNow + dueTax),
    next_renewal: money(renewal + renewTax), next_renewal_at: period.end, expires_at: input.expires_at,
    customer_id: ids.customer_id, subscription_id: ids.subscription_id, expected_subscription_revision: ids.expected_subscription_revision,
  }
  const digest = createHash('sha256').update(canonicalJson(body)).digest('hex')
  const { kind: _k, ...rest } = body
  void _k
  return { id: ids.id, ...rest, digest }
}
