import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { addCadence, initialOrderStates, type Quote } from '@liwan/commercial-contracts'
import { compileEntitlements, computeQuote, sealEntitlement } from '@liwan/commercial-contracts/server'
import { digestOf } from './lifecycle.js'
import { loadRelease } from './bundles.js'
import { loadQuoteSources, pricingBaseline } from './quotes.js'
import { enqueueOutbox } from './outbox.js'

type Pricing = {
  paid_extra_branches: number; paid_users: number; paid_storage_gb: number; base_minor: number
  bundle_minor: Record<string, number>; branch_unit_minor: number; user_unit_minor: number; storage_unit_minor: number
}

/**
 * Whether a subscription's applied pricing owes anything at renewal. The pricing baseline is the single record of
 * what a subscription costs per period, so a renewal that owes nothing (the free base, or a free plan) needs no
 * invoice, no payment attempt, no return origin and no dunning. A snapshot without a baseline is treated as owing.
 */
export function owesAtRenewal(pricing: Pricing | undefined | null): boolean {
  if (!pricing) return true
  const bundles = Object.values(pricing.bundle_minor).reduce((sum, minor) => sum + minor, 0)
  return pricing.base_minor + bundles + pricing.paid_extra_branches * pricing.branch_unit_minor
    + pricing.paid_users * pricing.user_unit_minor + pricing.paid_storage_gb * pricing.storage_unit_minor > 0
}

/** The free base of one trial: the pinned plan with only its included bundles, at the plan's included quantities. */
export type FreeBase = { quote: Quote; entitlement: ReturnType<typeof compileEntitlements>; start: string; end: string }

/**
 * The entitlement a trial falls back to when it ends, or `null` when the plan has no free base, so the trial ends in
 * its first invoice instead. The base is derived from the same catalog and plan data the subscription already pinned:
 * the applications the catalog marks as core stay open, every sellable application is closed, and users and storage
 * drop to the plan's included quantities. A subscription on negotiated customer terms has a paid agreement, so it is
 * never moved onto a base the customer did not choose.
 */
export async function freeBaseOf(client: Pick<PoolClient, 'query'>, input: { subscription: Record<string, any>; snapshot: Record<string, any>; start: string }): Promise<FreeBase | null> {
  const { subscription, snapshot, start } = input
  if (snapshot.terms_revision_id) return null
  const sources = await loadQuoteSources(client, subscription.customer_id, { plan_revision_id: snapshot.plan_revision_id, bundle_revision_ids: [] }, false)
  sources.terms = null
  sources.release = await loadRelease(client, snapshot.entitlement.catalog_release_id)
  const { plan } = sources
  const requested = { users: plan.included_users, storage_mb: plan.included_storage_mb }
  const extraBranches = Math.min(Number(snapshot.extra_branch_count ?? 0), plan.included_extra_branches)
  const entitlement = compileEntitlements({ ...sources, quantities: requested })
  const end = addCadence(start, snapshot.cadence, 1)
  const quote = computeQuote({ ...sources, kind: 'new', cadence: snapshot.cadence, requested_extra_branches: extraBranches,
    requested_users: requested.users, requested_storage_mb: requested.storage_mb, effective_date: start, period: { start, end },
    ids: { id: randomUUID(), customer_id: subscription.customer_id, subscription_id: subscription.id, expected_subscription_revision: subscription.revision },
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(), entitlement_digest: entitlement.digest })
  if (quote.due_now.minor !== 0 || quote.next_renewal.minor !== 0) return null
  return { quote, entitlement, start, end }
}

/**
 * The free base held at the limits current usage already exceeds (owner decision 2026-11-10, #491). Every paid application
 * stays closed and every base key open, exactly as in the full base; a limit that usage exceeds is kept at `ceilings[key]`
 * (the usage itself, so the host's downgrade check passes and Odoo refuses any addition), and a limit that cannot be judged
 * keeps its previous value. Limits usage fits drop to the free value as usual.
 */
export function freeBaseAtCeilings(free: FreeBase, ceilings: ReadonlyMap<string, number | null>): FreeBase['entitlement'] {
  const features = Object.fromEntries(Object.entries(free.entitlement.features).map(([key, value]) => [key, ceilings.has(key) ? ceilings.get(key)! : value])) as Record<string, boolean | number | null>
  return sealEntitlement({ catalog_release_id: free.entitlement.catalog_release_id, modules: free.entitlement.modules, features })
}

/**
 * Orders the lowering to the free base as an ordinary zero-due change order, so the shared worker pushes it through the
 * same reconfigure job as every other entitlement change: the closed applications and the free limits. The caller holds
 * the subscription row lock and has checked that no other order is pending; the order key (one per attempt) makes a
 * repeated call a no-op. Returns the order id, or null when this attempt was already ordered.
 */
export async function orderFreeBase(client: PoolClient, input: { subscription: Record<string, any>; snapshot: Record<string, any>; free: FreeBase; attempt: number; entitlement?: FreeBase['entitlement'] }): Promise<{ orderId: string; revisionId: string } | null> {
  const { subscription, snapshot, free } = input
  const entitlement = input.entitlement ?? free.entitlement
  const { quote } = free
  const key = `trial-lapse:${subscription.id}:${input.attempt}`
  if ((await client.query('SELECT 1 FROM orders WHERE customer_id=$1 AND idempotency_key=$2', [subscription.customer_id, key])).rowCount) return null
  const { branch_archive_ids: _archive, branch_restore_ids: _restore, ...kept } = snapshot
  const plan = (await client.query('SELECT included_users,included_storage_mb FROM plan_revisions WHERE id=$1', [snapshot.plan_revision_id])).rows[0]
  const next = { ...kept, bundle_revision_ids: quote.bundle_revision_ids, terms_revision_id: null, period_start: free.start, period_end: free.end,
    // The real number of extra branches, whatever the free base prices: later branch calculations start from the real set.
    extra_branch_count: (await client.query("SELECT count(*)::int AS n FROM commercial_branches WHERE subscription_id=$1 AND kind='extra' AND state IN ('active','pending')", [subscription.id])).rows[0].n,
    entitlement, quote_id: quote.id, free_base: true,
    pricing: pricingBaseline(quote, { extra_branches: snapshot.included_extra_branches, users: plan.included_users, storage_mb: plan.included_storage_mb }) }
  const revisionId = randomUUID()
  await client.query('INSERT INTO commercial_quotes(id,customer_id,payload,digest,expires_at) VALUES($1,$2,$3,$4,$5)',
    [quote.id, subscription.customer_id, JSON.stringify(quote), quote.digest, quote.expires_at])
  await client.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,$3,$4,$5)',
    [revisionId, subscription.id, subscription.revision + 1, JSON.stringify(next), quote.id])
  await client.query('UPDATE subscriptions SET target_revision_id=$2,revision=revision+1 WHERE id=$1', [subscription.id, revisionId])
  const states = initialOrderStates(quote.due_now)
  const order = (await client.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,expected_applied_revision_id,
    payment_state,fulfillment_state,effective_at,idempotency_key,request_digest,due_now_minor,currency,exponent)
    VALUES($1,$2,$3,'change',$4,$5,$6,$7,$8,$9,$10,$11,0,$12,$13) RETURNING id`,
  [randomUUID(), subscription.customer_id, subscription.id, quote.id, revisionId, subscription.applied_revision_id, states.payment_state, states.fulfillment_state,
    `${free.start}T00:00:00+03:00`, key, digestOf({ subscription_id: subscription.id, applied_revision_id: subscription.applied_revision_id, attempt: input.attempt }), quote.due_now.currency, quote.due_now.exponent])).rows[0]
  await enqueueOutbox(client, { kind: 'fulfillment.enqueue', aggregate_id: order.id, dedupe_key: revisionId,
    payload: { order_id: order.id, subscription_id: subscription.id, target_revision_id: revisionId } })
  const closed = Object.entries(entitlement.features).filter(([, value]) => value === false).map(([name]) => name)
  await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(), 'system:trial-expiry', 'trial.free_base_ordered', subscription.id, 'The subscription is being lowered to the free base',
      JSON.stringify({ from_revision_id: subscription.applied_revision_id, to_revision_id: revisionId, attempt: input.attempt, closed_feature_count: closed.length })])
  return { orderId: order.id as string, revisionId }
}
