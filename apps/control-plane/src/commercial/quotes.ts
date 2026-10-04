import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { CommercialError, compileEntitlements, computeQuote } from '@nasq/commercial-contracts/server'
import { addCadence, riyadhDate, quotePreviewRequestSchema, quoteRequestSchema, quoteSchema, type CustomerTermsRevision, type Quote } from '@nasq/commercial-contracts'
import { loadCustomerTerms } from './customer-terms.js'
import type { PoolClient } from 'pg'
import { policyWire } from './policies.js'
import { transaction } from '../db.js'
import { CommercialHttpError, toIssue } from './lifecycle.js'
import { bundleRevision, loadRelease } from './bundles.js'
import { planIssues, planRevision } from './plans.js'
import { getPolicy } from './policies.js'
import { assertDowngradeFitsUsage } from './usage.js'

const TTL_MS = 30 * 60 * 1000
const bad = (code: string, field: string, status = 422) => new CommercialHttpError(code, status, field, [{ code, field }])

export async function previewQuote(pool: Pool, value: unknown, now: Date = new Date()): Promise<Quote> {
  const input = quotePreviewRequestSchema.parse(value)
  if (input.customer_id) {
    const { customer_id, ...request } = input
    return createQuoteForCustomer(pool, { customer_id, request }, now)
  }
  if (input.kind !== 'new') throw bad('customer_required', 'customer_id')
  if (input.terms_revision_id) throw bad('customer_required', 'customer_id')
  if (input.subscription_id) throw bad('invalid', 'subscription_id')
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
      const snapshot = compileEntitlements({ release, plan, bundles, terms: null })
      const effective = input.effective_date ?? riyadhDate(now)
      const id = randomUUID()
      const quote = computeQuote({
        kind: 'new', plan, bundles, terms: null, cadence: input.cadence, requested_extra_branches: input.requested_extra_branches,
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

/** Shared quote/acceptance loader: customer-specific terms can never cross customer boundaries. */
export async function loadQuoteSources(client: PoolClient, customerId: string, input: { plan_revision_id: string; bundle_revision_ids: string[]; terms_revision_id?: string | null }, sellable = true) {
  const p = await client.query('SELECT * FROM plan_revisions WHERE id=$1 FOR SHARE', [input.plan_revision_id])
  if (!p.rowCount) throw bad('not_found', 'plan_revision_id', 404)
  const row = p.rows[0]
  const visible = (r: any) => r.audience_customer_id === null || r.audience_customer_id === customerId
  if (!visible(row)) throw bad('not_found', 'plan_revision_id', 404)
  const ids = [...new Set([...row.included_bundle_revision_ids, ...input.bundle_revision_ids])]
  const b = ids.length ? await client.query('SELECT * FROM bundle_revisions WHERE id=ANY($1::uuid[]) FOR SHARE', [ids]) : { rows: [] as any[] }
  if (b.rows.length !== ids.length || b.rows.some(r => !visible(r))) throw bad('not_found', 'bundle_revision_ids', 404)
  if (sellable && ([row, ...b.rows].some(r => r.status !== 'published' || !r.available))) throw bad('not_sellable', 'plan_revision_id')
  const bundles = ids.map(id => bundleRevision(b.rows.find(r => r.id === id)))
  const releaseId = bundles[0]?.catalog_release_id ?? (await client.query('SELECT id FROM catalog_releases ORDER BY created_at DESC,id LIMIT 1')).rows[0]?.id
  if (!releaseId) throw bad('release_missing', 'catalog_release_id')
  const release = await loadRelease(client, releaseId)
  const policyResult = await client.query("SELECT * FROM pricing_policy_revisions WHERE id=$1 AND status='approved'", [row.policy_revision_id])
  if (!policyResult.rowCount) throw bad('policy_missing', 'policy_revision_id')
  const terms = await loadCustomerTerms(client, customerId, input.terms_revision_id)
  return { plan: planRevision(row), bundles, release, terms, policy: policyWire(policyResult.rows[0]) }
}

export async function createQuoteForCustomer(pool: Pool, value: { customer_id: string; request: unknown; previewTerms?: CustomerTermsRevision }, now = new Date()): Promise<Quote> {
  const input = quoteRequestSchema.parse(value.request)
  return transaction(pool, async client => {
    const customer = await client.query('SELECT * FROM customers WHERE id=$1', [value.customer_id])
    if (!customer.rowCount) throw bad('not_found', 'customer_id', 404)
    const s = (await client.query('SELECT * FROM subscriptions WHERE customer_id=$1 FOR SHARE', [value.customer_id])).rows[0]
    if (input.subscription_id && input.subscription_id !== s?.id) throw bad('not_found', 'subscription_id', 404)
    if (input.expected_subscription_revision !== undefined && input.expected_subscription_revision !== (s?.revision ?? 0)) throw bad('revision_conflict', 'expected_subscription_revision', 409)
    if (input.kind === 'new' && s?.applied_revision_id) throw bad('revision_conflict', 'kind', 409)
    let current: any, applied: any
    const effective = process.env.NODE_ENV !== 'production' && input.effective_date ? input.effective_date : riyadhDate(now)
    let period = { start: effective, end: addCadence(effective, input.cadence, 1) }
    if (input.kind === 'change') {
      if (!s?.applied_revision_id) throw bad('subscription_required', 'kind', 409)
      applied = (await client.query('SELECT snapshot FROM subscription_revisions WHERE id=$1', [s.applied_revision_id])).rows[0]?.snapshot
      if (!applied) throw bad('subscription_required', 'kind', 409)
      if (JSON.stringify(applied.cadence) !== JSON.stringify(input.cadence)) throw bad('cadence_change_unsupported', 'cadence')
      period = { start: applied.period_start, end: applied.period_end }
      current = applied.pricing
      if (!current) {
        const old = (await client.query('SELECT payload FROM commercial_quotes WHERE id=$1', [applied.quote_id])).rows[0]?.payload
        if (!old) throw bad('baseline_missing', 'subscription_id', 409)
        current = pricingBaseline(old, applied.included_extra_branches)
      }
    }
    const sources = await loadQuoteSources(client, value.customer_id, input)
    if (value.previewTerms) {
      if (value.previewTerms.customer_id !== value.customer_id) throw bad('not_found', 'customer_id', 404)
      sources.terms = value.previewTerms
    }
    const entitlement = compileEntitlements(sources)
    if (input.kind === 'change') await assertDowngradeFitsUsage(client, {
      tenant_id: customer.rows[0].tenant_id, subscription_id: s.id,
      previous: applied.entitlement?.features ?? {}, target: entitlement.features, now,
    })
    try {
      const quote = computeQuote({ ...sources, kind: input.kind, cadence: input.cadence, requested_extra_branches: input.requested_extra_branches,
        current, effective_date: effective, period, ids: { id: randomUUID(), customer_id: value.customer_id, subscription_id: s?.id ?? null, expected_subscription_revision: s?.revision ?? 0 },
        expires_at: new Date(now.getTime() + TTL_MS).toISOString(), entitlement_digest: entitlement.digest })
      if (!value.previewTerms) await client.query('INSERT INTO commercial_quotes(id,customer_id,payload,digest,expires_at) VALUES($1,$2,$3,$4,$5)', [quote.id, value.customer_id, JSON.stringify(quote), quote.digest, quote.expires_at])
      return quoteSchema.parse(quote)
    } catch (e) {
      if (e instanceof CommercialError) { const i = toIssue(e); throw new CommercialHttpError(i.code, 422, i.field, [i]) }
      throw e
    }
  })
}

export function pricingBaseline(quote: Quote, included: number) {
  // Persisted quotes do not include request kind. The full base line identifies
  // the target cycle: initial (including reselection) uses now; changes use renewal.
  const timing = quote.lines.find(l => l.key === 'base' && l.kind === 'base')?.timing
  const lines = quote.lines.filter(l => l.timing === timing && !l.key.endsWith(':delta'))
  const branch = lines.find(l => l.kind === 'branch')
  return { plan_revision_id: quote.plan_revision_id, bundle_revision_ids: quote.bundle_revision_ids,
    paid_extra_branches: Math.max(0, quote.requested_extra_branches - included), base_minor: lines.find(l => l.kind === 'base')?.amount.minor ?? 0,
    bundle_minor: Object.fromEntries(lines.filter(l => l.kind === 'bundle').map(l => [l.source_revision_id, l.amount.minor])),
    branch_unit_minor: branch && branch.quantity ? branch.amount.minor / branch.quantity : 0 }
}
