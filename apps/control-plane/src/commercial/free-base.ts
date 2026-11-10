import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { addCadence } from '@liwan/commercial-contracts'
import { compileEntitlements, computeQuote, sealEntitlement } from '@liwan/commercial-contracts/server'
import { digestOf } from './lifecycle.js'
import { loadRelease } from './bundles.js'
import { loadQuoteSources, pricingBaseline, pricingOf } from './quote-sources.js'
import { enqueueOutbox } from './outbox.js'
import { paidTrialLines, trialLedger } from './trial-ledger.js'

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
  AND tl.state IN ('pending','ordered'))`

export async function unresolvedLapse(client: Pick<PoolClient, 'query'>, subscription: { id: string; applied_revision_id: string }): Promise<{ period_start: string } | null> {
  const lapse = (await client.query("SELECT period_start::text AS period_start FROM trial_lapses WHERE subscription_id=$1 AND state IN ('pending','ordered')",
    [subscription.id])).rows[0]
  return lapse ?? null
}

/** `owesAtRenewal` as SQL over a pricing jsonb expression, for lists that cannot call the function. */
export const owesAtRenewalSql = (pricing: string) => `(${pricing} IS NULL OR (
  COALESCE((SELECT sum(value::numeric) FROM jsonb_each_text(${pricing}->'bundle_minor')), 0) + COALESCE((${pricing}->>'base_minor')::numeric, 0)
  + COALESCE((${pricing}->>'paid_extra_branches')::numeric * (${pricing}->>'branch_unit_minor')::numeric, 0)
  + COALESCE((${pricing}->>'paid_users')::numeric * (${pricing}->>'user_unit_minor')::numeric, 0)
  + COALESCE((${pricing}->>'paid_storage_gb')::numeric * (${pricing}->>'storage_unit_minor')::numeric, 0)) > 0)`

export const trialOutcome = (kept: TrialLedger['kept']) =>
  kept.bundle_revision_ids.length || kept.paid_users || kept.paid_storage_gb || kept.paid_extra_branches ? 'kept_subset' as const : 'free_base' as const

type TrialLedger = ReturnType<typeof trialLedger>
export type TrialEnd = Awaited<ReturnType<typeof keptAtTrialEnd>>

/** Both the host fallback and the final lock are priced from the same paid invoice lines. */
export async function keptAtTrialEnd(client: Pick<PoolClient, 'query'>, input: {
  subscription: Record<string, any>; snapshot: Record<string, any>; start: string; cutoff: Date; forceEmpty?: boolean
}) {
  const { subscription, snapshot, start, cutoff } = input
  const sources = await loadQuoteSources(client, subscription.customer_id, {
    plan_revision_id: snapshot.plan_revision_id, bundle_revision_ids: snapshot.bundle_revision_ids, terms_revision_id: snapshot.terms_revision_id,
  }, false)
  if (!snapshot.terms_revision_id) sources.terms = null
  sources.release = await loadRelease(client, snapshot.entitlement.catalog_release_id)
  const { plan } = sources
  const applied = await pricingOf(client, snapshot)
  const branches = (await client.query(`SELECT count(*) FILTER (WHERE billing='paid')::int AS paid,count(*)::int AS live
    FROM commercial_branches WHERE subscription_id=$1 AND kind='extra' AND state IN ('active','pending')
    AND NOT (id=ANY($2::uuid[]))`, [subscription.id, snapshot.branch_archive_ids ?? []])).rows[0]
  const ledger = trialLedger(input.forceEmpty ? [] : await paidTrialLines(client, subscription.id, cutoff), applied, plan, branches.paid)
  const keptIds = new Set([...plan.included_bundle_revision_ids, ...ledger.kept.bundle_revision_ids])
  sources.bundles = sources.bundles.filter(bundle => keptIds.has(bundle.id))
  const included = sources.terms?.included_extra_branches ?? plan.included_extra_branches
  const extra = included + ledger.kept.paid_extra_branches
  const quantities = { users: plan.included_users + ledger.kept.paid_users, storage_mb: plan.included_storage_mb + ledger.kept.paid_storage_gb * 1024 }
  const entitlement = compilePurchasedEntitlement({ ...sources, quantities, extraBranches: extra })
  const end = addCadence(start, snapshot.cadence, 1)
  const quoteInput = { ...sources, kind: 'new' as const, cadence: snapshot.cadence, requested_extra_branches: extra,
    requested_users: quantities.users, requested_storage_mb: quantities.storage_mb, effective_date: start, period: { start, end },
    ids: { id: randomUUID(), customer_id: subscription.customer_id, subscription_id: subscription.id, expected_subscription_revision: subscription.revision },
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(), entitlement_digest: entitlement.digest }
  const full = computeQuote(quoteInput)
  const pricing = pricingBaseline(full, { extra_branches: included, users: plan.included_users, storage_mb: plan.included_storage_mb })
  const quote = computeQuote({ ...quoteInput, paid_through: ledger.paid_through })
  return { quote, entitlement, pricing, start, end, ledger, included, liveBranches: branches.live as number }
}

/** The catalog limit is a sales ceiling. An applied post-trial entitlement grants the purchased capacity. */
export function compilePurchasedEntitlement(input: Parameters<typeof compileEntitlements>[0] & { extraBranches?: number }) {
  const entitlement = compileEntitlements(input)
  if (input.extraBranches === undefined) return entitlement
  const ceiling = entitlement.features['branches.extra_limit']
  const extra = typeof ceiling === 'number' ? Math.min(ceiling, input.extraBranches) : input.extraBranches
  return sealEntitlement({ ...entitlement, features: { ...entitlement.features, 'branches.extra_limit': extra } })
}

/** Queue one zero-due lock; the separately generated renewal is the only payable order. */
export async function orderTrialLock(client: PoolClient, input: {
  subscription: Record<string, any>; snapshot: Record<string, any>; lock: TrialEnd; attempt: number
}) {
  const { subscription, snapshot, lock } = input
  const { quote, entitlement } = lock
  const key = `trial-lapse:${subscription.id}:${input.attempt}`
  const { branch_archive_ids: _archive, branch_restore_ids: _restore, ...previous } = snapshot
  const next = { ...previous, bundle_revision_ids: quote.bundle_revision_ids, terms_revision_id: quote.terms_revision_id,
    period_start: lock.start, period_end: lock.end, included_extra_branches: lock.included,
    extra_branch_count: lock.liveBranches, entitlement, quote_id: quote.id, trial_end: true, pricing: lock.pricing }
  const revisionId = randomUUID()
  const orderId = randomUUID()
  const lockQuote = { ...quote, due_now: { ...quote.due_now, minor: 0 } }
  lockQuote.digest = digestOf({ ...lockQuote, digest: undefined })
  await client.query('INSERT INTO commercial_quotes(id,customer_id,payload,digest,expires_at) VALUES($1,$2,$3,$4,$5)',
    [quote.id, subscription.customer_id, JSON.stringify(lockQuote), lockQuote.digest, quote.expires_at])
  await client.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,$3,$4,$5)',
    [revisionId, subscription.id, subscription.revision + 1, JSON.stringify(next), quote.id])
  await client.query('UPDATE subscriptions SET target_revision_id=$2,revision=revision+1 WHERE id=$1', [subscription.id, revisionId])
  await client.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,expected_applied_revision_id,
    payment_state,fulfillment_state,effective_at,idempotency_key,request_digest,due_now_minor,currency,exponent)
    VALUES($1,$2,$3,'change',$4,$5,$6,'not_required','queued',$7,$8,$9,0,$10,$11)`,
  [orderId, subscription.customer_id, subscription.id, quote.id, revisionId, subscription.applied_revision_id,
    `${lock.start}T00:00:00+03:00`, key, digestOf({ subscription_id: subscription.id, applied_revision_id: subscription.applied_revision_id, attempt: input.attempt }), quote.due_now.currency, quote.due_now.exponent])
  await enqueueOutbox(client, { kind: 'fulfillment.enqueue', aggregate_id: orderId, dedupe_key: revisionId,
    payload: { order_id: orderId, subscription_id: subscription.id, target_revision_id: revisionId } })
  return orderId
}
