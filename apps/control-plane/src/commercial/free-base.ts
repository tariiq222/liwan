import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { addCadence, initialOrderStates, type Quote } from '@liwan/commercial-contracts'
import { compileEntitlements, computeQuote, sealEntitlement } from '@liwan/commercial-contracts/server'
import { digestOf } from './lifecycle.js'
import { loadRelease } from './bundles.js'
import { loadQuoteSources, pricingBaseline } from './quote-sources.js'
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

/**
 * The effective commercial baseline of a subscription is the free base from the moment its trial lapses, but its APPLIED
 * snapshot stays the paid trial configuration until the lock order applies. This is the one definition of that window:
 * an unresolved lapse (`pending` or `ordered`: the lock is not applied yet) whose trial revision is still the applied one. Quotes, renewals and dunning
 * all ask here instead of reading the snapshot's own pricing, so none of them bills or prices the trial configuration.
 */
export const holdsTrialAfterLapseSql = (subscription: string) => `EXISTS (SELECT 1 FROM trial_lapses tl WHERE tl.subscription_id=${subscription}.id
  AND tl.trial_revision_id=${subscription}.applied_revision_id AND tl.state IN ('pending','ordered'))`

export async function unresolvedLapse(client: Pick<PoolClient, 'query'>, subscription: { id: string; applied_revision_id: string }): Promise<{ period_start: string } | null> {
  const lapse = (await client.query("SELECT period_start::text AS period_start FROM trial_lapses WHERE subscription_id=$1 AND trial_revision_id=$2 AND state IN ('pending','ordered')",
    [subscription.id, subscription.applied_revision_id])).rows[0]
  return lapse ?? null
}

/** `owesAtRenewal` as SQL over a pricing jsonb expression, for lists that cannot call the function. */
export const owesAtRenewalSql = (pricing: string) => `(${pricing} IS NULL OR (
  COALESCE((SELECT sum(value::numeric) FROM jsonb_each_text(${pricing}->'bundle_minor')), 0) + COALESCE((${pricing}->>'base_minor')::numeric, 0)
  + COALESCE((${pricing}->>'paid_extra_branches')::numeric * (${pricing}->>'branch_unit_minor')::numeric, 0)
  + COALESCE((${pricing}->>'paid_users')::numeric * (${pricing}->>'user_unit_minor')::numeric, 0)
  + COALESCE((${pricing}->>'paid_storage_gb')::numeric * (${pricing}->>'storage_unit_minor')::numeric, 0)) > 0)`

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
 * The entitlement of the lock order: the free base's applications (paid ones closed, base ones open) with every numeric limit
 * exactly where the subscription has it (owner decision 2026-11-10: the lock never lowers a limit, so no usage check can refuse
 * it and a customer who adds a user meanwhile cannot make it fail). A limit the previous entitlement does not state stays unlimited.
 */
export function lockEntitlement(free: FreeBase, previous: Features): FreeBase['entitlement'] {
  const features = Object.fromEntries(Object.entries(free.entitlement.features).map(([key, value]) => {
    if (typeof value !== 'number' || key === 'branches.extra_limit') return [key, value]
    const before = previous[key]
    return [key, typeof before === 'number' ? before : null]
  })) as Features
  return sealEntitlement({ catalog_release_id: free.entitlement.catalog_release_id, modules: free.entitlement.modules, features })
}

/** A quantity the customer holds above what is purchased, kept from the trial (owner decision 2026-11-10): `held` is what the entitlement carries, `target` what is purchased. It ends only when the customer names a quantity. */
/** The quantities a customer can name in a request, and so the only held keys the customer, the notice and the vendor list ever see. */
export const HELD_QUANTITY_KEYS = ['users.limit', 'storage.limit_mb'] as const
export type HeldCeilings = Record<string, { held: number; target: number }>
type Features = Record<string, boolean | number | null>

/** The typed marker a snapshot carries for its held ceilings; the entitlement's own limits are never read as purchases. */
export const heldCeilingsOf = (snapshot: Record<string, any> | null | undefined): HeldCeilings => snapshot?.held_ceilings ?? {}

/**
 * The numeric limits of `features` that sit above their `targets`. Users and storage are the held quantities; the limit of a
 * closed application is held too, only so that a later change does not look like a downgrade the usage check cannot judge.
 */
export function heldAgainst(features: Features, targets: Features): HeldCeilings {
  const held: HeldCeilings = {}
  for (const [key, value] of Object.entries(features)) {
    const target = targets[key]
    if (key !== 'branches.extra_limit' && typeof value === 'number' && typeof target === 'number' && value > target) held[key] = { held: value, target }
  }
  return held
}

/**
 * What the subscription has PURCHASED of the limits a customer can ask to change: the quantity a held ceiling falls to, else
 * the entitlement's own limit. A change that does not mention users or storage (a branch change) asks for exactly this, so a
 * held ceiling is carried forward as held at no charge; a request that names the held quantity itself is a purchase of it.
 */
export async function purchasedLimits(client: Pick<PoolClient, 'query'>, subscriptionId: string): Promise<{ users: number; storage_mb: number }> {
  const snapshot = (await client.query('SELECT rv.snapshot FROM subscriptions s JOIN subscription_revisions rv ON rv.id=s.applied_revision_id WHERE s.id=$1', [subscriptionId])).rows[0]?.snapshot
  const held = heldCeilingsOf(snapshot), features = snapshot?.entitlement?.features ?? {}
  return { users: Number(held['users.limit']?.target ?? features['users.limit'] ?? 0), storage_mb: Number(held['storage.limit_mb']?.target ?? features['storage.limit_mb'] ?? 0) }
}

/** A held quantity the previous snapshot has stays held, and marked, through any change that does not name it; a change that names a quantity buys it and drops the mark. */
export function carryHeldCeilings(entitlement: FreeBase['entitlement'], previous: Record<string, any> | null): { entitlement: FreeBase['entitlement']; held: HeldCeilings } {
  const before = heldCeilingsOf(previous)
  const features = { ...entitlement.features } as Features
  const held: HeldCeilings = {}
  for (const key of Object.keys(before)) {
    const value = features[key], ceiling = previous!.entitlement.features[key]
    if (typeof value === 'number' && typeof ceiling === 'number' && ceiling > value) { features[key] = ceiling; held[key] = { held: ceiling, target: value } }
  }
  if (!Object.keys(held).length) return { entitlement, held }
  return { entitlement: sealEntitlement({ catalog_release_id: entitlement.catalog_release_id, modules: entitlement.modules, features }), held }
}

/** The pricing baseline of the free base: what a change is priced from while the subscription is (or is about to be) on it. */
export async function freeBasePricing(client: Pick<PoolClient, 'query'>, snapshot: Record<string, any>, free: FreeBase) {
  const plan = (await client.query('SELECT included_users,included_storage_mb FROM plan_revisions WHERE id=$1', [snapshot.plan_revision_id])).rows[0]
  return pricingBaseline(free.quote, { extra_branches: snapshot.included_extra_branches, users: plan.included_users, storage_mb: plan.included_storage_mb })
}

/**
 * Orders the lock onto the free base as an ordinary zero-due change order, so the shared worker pushes it through the
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
  const held = heldAgainst(entitlement.features as Features, free.entitlement.features as Features)
  const next = { ...kept, bundle_revision_ids: quote.bundle_revision_ids, terms_revision_id: null, period_start: free.start, period_end: free.end,
    // The real number of extra branches, whatever the free base prices: later branch calculations start from the real set.
    extra_branch_count: (await client.query("SELECT count(*)::int AS n FROM commercial_branches WHERE subscription_id=$1 AND kind='extra' AND state IN ('active','pending')", [subscription.id])).rows[0].n,
    entitlement, quote_id: quote.id, free_base: true, ...(Object.keys(held).length ? { held_ceilings: held } : {}),
    pricing: await freeBasePricing(client, snapshot, free) }
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
    [randomUUID(), 'system:trial-expiry', 'trial.free_base_ordered', subscription.id, 'The subscription is being locked onto the free base',
      JSON.stringify({ from_revision_id: subscription.applied_revision_id, to_revision_id: revisionId, attempt: input.attempt, closed_feature_count: closed.length })])
  return { orderId: order.id as string, revisionId }
}
