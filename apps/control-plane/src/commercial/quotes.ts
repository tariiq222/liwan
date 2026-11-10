import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { CommercialError, compileEntitlements, computeQuote } from '@liwan/commercial-contracts/server'
import { addCadence, daysBetween, riyadhDate, quotePreviewRequestSchema, quoteRequestSchema, quoteSchema, type CustomerTermsRevision, type Quote } from '@liwan/commercial-contracts'
import type { PoolClient } from 'pg'
import { transaction } from '../db.js'
import { CommercialHttpError, toIssue } from './lifecycle.js'
import { bundleRevision, loadRelease } from './bundles.js'
import { loadQuoteSources, pricingOf } from './quote-sources.js'
import { planIssues, planRevision } from './plans.js'
import { getPolicy } from './policies.js'
import { assertDowngradeFitsUsage } from './usage.js'
import { compilePurchasedEntitlement, unresolvedLapse } from './free-base.js'
import { resolveTopupAmount } from './ai-topup.js'

const TTL_MS = 30 * 60 * 1000
const bad = (code: string, field: string, status = 422) => new CommercialHttpError(code, status, field, [{ code, field }])
/** A compiler refusal is a 422 with its code and field, exactly like one from `computeQuote` below. */
function compileOrRefuse<T>(compile: () => T): T {
  try { return compile() } catch (e) {
    if (e instanceof CommercialError) { const i = toIssue(e); throw bad(i.code, i.field ?? 'quantities') }
    throw e
  }
}

export async function previewQuote(pool: Pool, value: unknown, now: Date = new Date()): Promise<Quote> {
  const input = quotePreviewRequestSchema.parse(value)
  if (input.customer_id) {
    const { customer_id, ...request } = input
    return createQuoteForCustomer(pool, { customer_id, request }, now)
  }
  if (input.kind !== 'new') throw bad('customer_required', 'customer_id')
  if (input.terms_revision_id) throw bad('customer_required', 'customer_id')
  if (input.subscription_id) throw bad('invalid', 'subscription_id')
  if (input.ai_topup_minor !== undefined) throw bad('customer_required', 'customer_id')
  const customer = input.customer_id ?? 'preview'
  return transaction(pool, async client => {
    const p = await client.query('SELECT * FROM plan_revisions WHERE id=$1', [input.plan_revision_id])
    if (!p.rowCount) throw bad('plan_missing', 'plan_revision_id', 404)
    const planRow = p.rows[0]
    if (planRow.status !== 'published' || !planRow.available) throw bad('plan_unavailable', 'plan_revision_id')
    if (planRow.audience_customer_id !== null && planRow.audience_customer_id !== customer) throw bad('plan_missing', 'plan_revision_id', 404)
    const ids = [...new Set(input.bundle_revision_ids)]
    if (ids.length !== input.bundle_revision_ids.length) throw bad('bundle_duplicated', 'bundle_revision_ids')
    const b = ids.length ? await client.query('SELECT * FROM bundle_revisions WHERE id=ANY($1::uuid[])', [ids]) : { rows: [] as any[] }
    const byId = new Map(b.rows.map((r: any) => [r.id, r]))
    const bundleRows = ids.map(id => byId.get(id))
    for (const r of bundleRows) {
      if (!r) throw bad('bundle_missing', 'bundle_revision_ids')
      if (r.status !== 'published' || !r.available) throw bad('bundle_unavailable', 'bundle_revision_ids')
      if (r.audience_customer_id !== null && r.audience_customer_id !== customer) throw bad('bundle_missing', 'bundle_revision_ids', 404)
    }
    const planIds: string[] = [...planRow.included_bundle_revision_ids, ...planRow.optional_bundle_revision_ids]
    let releaseId: string | undefined = bundleRows[0]?.catalog_release_id
    if (!releaseId && planIds.length) releaseId = (await client.query('SELECT catalog_release_id FROM bundle_revisions WHERE id=$1', [planIds[0]])).rows[0]?.catalog_release_id
    if (!releaseId) releaseId = (await client.query('SELECT id FROM catalog_releases ORDER BY created_at DESC,id LIMIT 1')).rows[0]?.id
    if (!releaseId) throw bad('release_missing', 'catalog_release_id')
    const release = await loadRelease(client, releaseId)
    const policy = await getPolicy(pool, planRow.policy_revision_id).catch(() => { throw bad('policy_missing', 'policy_revision_id') })
    const plan = planRevision(planRow), bundles = bundleRows.map(r => bundleRevision(r))
    try {
      const snapshot = compileEntitlements({ release, plan, bundles, terms: null, quantities: { users: input.requested_users, storage_mb: input.requested_storage_mb } })
      const effective = input.effective_date ?? riyadhDate(now)
      const id = randomUUID()
      const quote = computeQuote({
        kind: 'new', plan, bundles, terms: null, cadence: input.cadence, requested_extra_branches: input.requested_extra_branches,
        requested_users: input.requested_users, requested_storage_mb: input.requested_storage_mb,
        effective_date: effective, period: { start: effective, end: addCadence(effective, input.cadence, 1) }, policy,
        ids: { id, customer_id: customer, subscription_id: null, expected_subscription_revision: 0 },
        expires_at: new Date(now.getTime() + TTL_MS).toISOString(), entitlement_digest: snapshot.digest,
      })
      await client.query('INSERT INTO commercial_quotes(id,customer_id,payload,digest,expires_at) VALUES($1,$2,$3,$4,$5)', [quote.id, customer, JSON.stringify(quote), quote.digest, quote.expires_at])
      return quoteSchema.parse(quote)
    } catch (e) {
      if (e instanceof CommercialError) { const i = toIssue(e); throw new CommercialHttpError(i.code, 422, i.field, [i]) }
      throw e
    }
  })
}
export async function getQuote(pool: Pool, id: string): Promise<Quote> {
  const r = await pool.query('SELECT payload FROM commercial_quotes WHERE id=$1', [id])
  if (!r.rowCount) throw new CommercialHttpError('quote_missing', 404)
  return quoteSchema.parse(r.rows[0].payload)
}
export { planIssues }

type QuoteInput = { customer_id: string; request: unknown; previewTerms?: CustomerTermsRevision; branchArchiveIds?: string[] }
async function quoteForCustomerOn(client: PoolClient, value: QuoteInput, now: Date, persist: boolean): Promise<Quote> {
  const input = quoteRequestSchema.parse(value.request)
  const customer = await client.query('SELECT * FROM customers WHERE id=$1', [value.customer_id])
  if (!customer.rowCount) throw bad('not_found', 'customer_id', 404)
  const s = (await client.query('SELECT * FROM subscriptions WHERE customer_id=$1 FOR SHARE', [value.customer_id])).rows[0]
  if (input.subscription_id && input.subscription_id !== s?.id) throw bad('not_found', 'subscription_id', 404)
  if (input.expected_subscription_revision !== undefined && input.expected_subscription_revision !== (s?.revision ?? 0)) throw bad('revision_conflict', 'expected_subscription_revision', 409)
  if (input.kind === 'new' && s?.applied_revision_id) throw bad('revision_conflict', 'kind', 409)
  // The assisted onboarding is a first-order item at the vendor's fee, offered only while a fee is set.
  let onboarding: { amount: { currency: string; exponent: number; minor: number } } | null = null
  if (input.onboarding) {
    if (input.kind !== 'new' || s?.applied_revision_id) throw bad('onboarding_first_order_only', 'onboarding')
    const fee = (await client.query('SELECT onboarding_fee_minor,onboarding_currency,onboarding_exponent FROM billing_settings WHERE singleton')).rows[0]
    if (!fee || Number(fee.onboarding_fee_minor) <= 0) throw bad('onboarding_unavailable', 'onboarding')
    onboarding = { amount: { currency: fee.onboarding_currency, exponent: Number(fee.onboarding_exponent), minor: Number(fee.onboarding_fee_minor) } }
  }
  let current: any, applied: any, prorationCycleDays: number | undefined
  const effective = process.env.NODE_ENV !== 'production' && input.effective_date ? input.effective_date : riyadhDate(now)
  let period = { start: effective, end: addCadence(effective, input.cadence, 1) }
  if (input.kind === 'change') {
    if (!s?.applied_revision_id) throw bad('subscription_required', 'kind', 409)
    applied = (await client.query('SELECT snapshot FROM subscription_revisions WHERE id=$1', [s.applied_revision_id])).rows[0]?.snapshot
    if (!applied) throw bad('subscription_required', 'kind', 409)
    if (JSON.stringify(applied.cadence) !== JSON.stringify(input.cadence)) throw bad('cadence_change_unsupported', 'cadence')
    period = appliedPeriod(s, applied)
    if (s.state === 'trialing' && s.trial_ends_at)
      prorationCycleDays = daysBetween(period.end, addCadence(period.end, input.cadence, 1))
    if (await unresolvedLapse(client, s)) throw bad('lock_pending', 'subscription_id', 409)
    if (s.state === 'trialing' && s.trial_ends_at && new Date(s.trial_ends_at).getTime() <= now.getTime())
      throw bad('trial_ending', 'subscription_id', 409)
    if (s.manual_suspension) throw bad('subscription_suspended', 'subscription_id', 409)
    current = await pricingOf(client, applied)

  }
  // A change against the subscription's own pinned revision stays quotable after that
  // revision is withdrawn from new sales; only a new sale requires a sellable plan.
  const pinnedChange = input.kind === 'change' && Boolean(s?.applied_revision_id)
  const sources = await loadQuoteSources(client, value.customer_id, input, !pinnedChange)
  if (value.previewTerms) {
    if (value.previewTerms.customer_id !== value.customer_id) throw bad('not_found', 'customer_id', 404)
    sources.terms = value.previewTerms
  }
  // A one-time AI balance top-up: validated against the vendor's offer, charged now, never part of a renewal.
  const ai_topup = input.ai_topup_minor === undefined ? null : await resolveTopupAmount(client, value.customer_id, input.ai_topup_minor, sources.plan)
  const entitlement = compileOrRefuse(() => compilePurchasedEntitlement({ ...sources,
    quantities: { users: input.requested_users, storage_mb: input.requested_storage_mb },
    extraBranches: applied?.trial_end ? Math.max(input.requested_extra_branches, sources.terms?.included_extra_branches ?? sources.plan.included_extra_branches) : undefined }))
  if (input.kind === 'change') await assertDowngradeFitsUsage(client, {
    tenant_id: customer.rows[0].tenant_id, subscription_id: s.id,
    previous: applied.entitlement?.features ?? {}, target: entitlement.features, branchArchiveIds: value.branchArchiveIds, now,
  })
  try {
    const quote = computeQuote({ ...sources, kind: input.kind, cadence: input.cadence, requested_extra_branches: input.requested_extra_branches,
      proration_cycle_days: prorationCycleDays,
      requested_users: input.requested_users, requested_storage_mb: input.requested_storage_mb,
      current, effective_date: effective, period, ids: { id: randomUUID(), customer_id: value.customer_id, subscription_id: s?.id ?? null, expected_subscription_revision: s?.revision ?? 0 },
      expires_at: new Date(now.getTime() + TTL_MS).toISOString(), entitlement_digest: entitlement.digest, onboarding, ai_topup })
    if (persist && !value.previewTerms) await client.query('INSERT INTO commercial_quotes(id,customer_id,payload,digest,expires_at) VALUES($1,$2,$3,$4,$5)', [quote.id, value.customer_id, JSON.stringify(quote), quote.digest, quote.expires_at])
    return quoteSchema.parse(quote)
  } catch (e) {
    if (e instanceof CommercialError) { const i = toIssue(e); throw new CommercialHttpError(i.code, 422, i.field, [i]) }
    throw e
  }
}

/** The in-memory half of a customer quote: same validation and pricing, no `commercial_quotes` row. */
export function buildQuote(pool: Pool, value: QuoteInput, now = new Date()): Promise<Quote> {
  return transaction(pool, client => buildQuoteOn(client, value, now))
}
export function buildQuoteOn(client: PoolClient, value: QuoteInput, now: Date): Promise<Quote> {
  return quoteForCustomerOn(client, value, now, false)
}
export function createQuoteForCustomer(pool: Pool, value: QuoteInput, now = new Date()): Promise<Quote> {
  return transaction(pool, client => quoteForCustomerOn(client, value, now, true))
}

/** Trial dates can be extended without mutating the last applied revision. */
export function appliedPeriod(subscription: { state: string; trial_ends_at: Date | null }, applied: { period_start: string; period_end: string }) {
  return { start: applied.period_start, end: subscription.state === 'trialing' && subscription.trial_ends_at
    ? riyadhDate(subscription.trial_ends_at) : applied.period_end }
}
