import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { riyadhDate, type BundleRevision, type CatalogRelease, type CustomerTermsRevision, type EntitlementSnapshot, type PlanRevision } from '@liwan/commercial-contracts'
import { CommercialError, computeQuote } from '@liwan/commercial-contracts/server'
import { transaction } from '../db.js'
import { digestOf, CommercialHttpError } from './lifecycle.js'
import { latestPublishedRelease } from './catalog-releases.js'
import { loadQuoteSources, pricingOf } from './quote-sources.js'
import { policyWire } from './policies.js'
import { compilePurchasedEntitlement, holdsFreeBaseLockSql, purchasedQuantities } from './free-base.js'
import { assertDowngradeFitsUsage } from './usage.js'
import { tenantRetiringSql } from './tenant-deletion-read.js'
import { enqueueOutbox } from './outbox.js'

type CompileSources = {
  release: CatalogRelease; plan: PlanRevision; bundles: BundleRevision[]; terms: CustomerTermsRevision | null
}

/**
 * The entitlement a subscription already owns, recompiled against the latest published release: the plan,
 * bundles, terms, policy and quantities stay exactly as they were bought, so nothing priced changes; only the
 * release and what it itself declares move (a new key of an owned application, a raised ceiling, the modules of
 * the whole release). The pinned bundle rows are re-pointed to that release in memory only, so the compiler
 * validates their content against it; the subscription keeps naming the same revisions it owns, and nothing in
 * the recompile can add one. A release that no longer carries what the subscription owns (a dropped application,
 * a removed limit) refuses to compile: the recompile then falls back to the pinned entitlement and logs, because
 * a catalog change must never break billing — the publish-time fan-out reports the incompatibility instead.
 */
export async function recompiledEntitlementOn(client: Pick<PoolClient, 'query'>, sources: CompileSources,
  quantities: { users: number; storage_mb: number }, extraBranches: number,
  pinned: EntitlementSnapshot | undefined, subject: string): Promise<EntitlementSnapshot> {
  const latest = await latestPublishedRelease(client)
  if (!latest) throw new CommercialHttpError('release_missing', 422, 'catalog_release_id')
  const against = latest.id === sources.release.id ? sources
    : { ...sources, release: latest, bundles: sources.bundles.map(b => ({ ...b, catalog_release_id: latest.id })) }
  try {
    return compilePurchasedEntitlement({ ...against, quantities, extraBranches })
  } catch (error) {
    if (!(error instanceof CommercialError) || !pinned) throw error
    console.error(JSON.stringify({ event: 'commercial_entitlement_recompile_fallback', subject, error: error.code, release: latest.id }))
    return pinned
  }
}

/**
 * Delivers the latest release to every subscription that owns a workspace: each one whose recomputed entitlement
 * digest differs from its applied revision gets a new revision and a zero-due change order, and the existing
 * fulfilment path queues the reconfigure job for it — the tenant write stays in that one path. Nothing is granted:
 * the recompile names exactly the revisions the snapshot owns, so an application the release adds is never added to
 * `bundle_revision_ids` (its keys stay closed). Idempotent: a subscription whose entitlement is current, or that
 * already carries a pending revision or order, is not a candidate. Per-subscription failures are logged and skipped,
 * like the renewal sweep; the next renewal recompiles anyway.
 */
export async function pushCatalogEntitlement(pool: Pool, release: Pick<CatalogRelease, 'id'>, { now = new Date() }: { now?: Date } = {}) {
  // The predicates are the ones a change order may be written under: the same rules `acceptQuoteOn` enforces per
  // customer, applied in bulk. A subscription whose period already ended renews into the release instead.
  let pushed = 0, failed = 0, candidates: { id: string; customer_id: string; revision: number; snapshot: Record<string, any> }[] = []
  try {
    candidates = (await pool.query(`SELECT s.id, s.customer_id, s.revision, sr.snapshot
      FROM subscriptions s JOIN subscription_revisions sr ON sr.id=s.applied_revision_id
      WHERE s.tenant_id IS NOT NULL AND s.applied_revision_id IS NOT NULL
        AND s.target_revision_id IS NULL AND NOT s.manual_suspension AND s.cancel_requested_at IS NULL
        AND s.state IN ('active','past_due') AND (sr.snapshot->>'period_end')::date >= $1::date
        AND NOT ${holdsFreeBaseLockSql('s')} AND NOT ${tenantRetiringSql('s.customer_id')}
        AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.subscription_id=s.id AND NOT o.cancelled AND o.fulfillment_state<>'applied')
      ORDER BY s.id`, [riyadhDate(now)])).rows
  } catch (error) {
    // The release is already published; the sweep must never fail it. The next renewal recompiles regardless.
    console.error(JSON.stringify({ event: 'commercial_catalog_push_failed', release_id: release.id, error: error instanceof Error ? error.message : String(error) }))
    return { pushed, failed, candidates: 0 }
  }
  for (const candidate of candidates) {
    try {
      const done = await transaction(pool, async client => {
        const sub = (await client.query('SELECT * FROM subscriptions WHERE id=$1 FOR UPDATE', [candidate.id])).rows[0]
        if (!sub?.applied_revision_id || sub.target_revision_id || sub.manual_suspension || sub.cancel_requested_at
          || !['active', 'past_due'].includes(sub.state)) return false
        const snapshot = (await client.query('SELECT snapshot FROM subscription_revisions WHERE id=$1', [sub.applied_revision_id])).rows[0].snapshot
        if (!snapshot.entitlement) throw new Error('applied_entitlement_missing')
        const subject = `subscription ${sub.id}`
        const sources = await loadQuoteSources(client, sub.customer_id, snapshot, snapshot)
        if (!snapshot.terms_revision_id) sources.terms = null
        // The price the subscription pays stays pinned: the quote reads the revision the snapshot names, exactly like a renewal.
        const policy = (await client.query('SELECT * FROM pricing_policy_revisions WHERE id=$1', [snapshot.policy_revision_id])).rows[0]
        if (!policy) throw new Error('pinned_policy_missing')
        sources.policy = policyWire(policy)
        const pricing = await pricingOf(client, snapshot)
        const { extra_branches: extraBranches, ...quantities } = purchasedQuantities(sources.plan, snapshot, pricing)
        const entitlement = await recompiledEntitlementOn(client, sources, quantities, extraBranches, snapshot.entitlement, subject)
        if (entitlement.digest === snapshot.entitlement.digest) return false
        // A lowered limit below current use is refused here, naming the count, instead of a delivery that would block the tenant.
        await assertDowngradeFitsUsage(client, { tenant_id: sub.tenant_id, subscription_id: sub.id,
          previous: snapshot.entitlement.features ?? {}, target: entitlement.features, now })
        const today = riyadhDate(now)
        const quote = computeQuote({ ...sources, kind: 'change', cadence: snapshot.cadence,
          requested_extra_branches: extraBranches, requested_users: quantities.users, requested_storage_mb: quantities.storage_mb,
          current: pricing, effective_date: today, period: { start: snapshot.period_start, end: snapshot.period_end },
          ids: { id: randomUUID(), customer_id: sub.customer_id, subscription_id: sub.id, expected_subscription_revision: sub.revision },
          expires_at: new Date(now.getTime() + 30 * 60_000).toISOString(), entitlement_digest: entitlement.digest })
        // A push buys nothing: a nonzero due would mean the recompile changed what is paid, which it must not.
        if (quote.due_now.minor !== 0) throw new Error('catalog_push_due_not_zero')
        await client.query('INSERT INTO commercial_quotes(id,customer_id,payload,digest,expires_at) VALUES($1,$2,$3,$4,$5)',
          [quote.id, sub.customer_id, JSON.stringify(quote), quote.digest, quote.expires_at])
        // The revision keeps every pinned fact of the applied one and moves only the entitlement: the archives the
        // applied revision carried are already applied, so they are not repeated.
        const { branch_archive_ids: _archive, branch_restore_ids: _restore, ...applied } = snapshot
        const revisionId = randomUUID(), orderId = randomUUID()
        await client.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,$3,$4,$5)',
          [revisionId, sub.id, sub.revision + 1, JSON.stringify({ ...applied, entitlement, quote_id: quote.id }), quote.id])
        await client.query('UPDATE subscriptions SET target_revision_id=$2,revision=revision+1 WHERE id=$1', [sub.id, revisionId])
        await client.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,expected_applied_revision_id,
          payment_state,fulfillment_state,effective_at,idempotency_key,request_digest,due_now_minor,currency,exponent)
          VALUES($1,$2,$3,'change',$4,$5,$6,'not_required','queued',$7,$8,$9,0,$10,$11)`,
        [orderId, sub.customer_id, sub.id, quote.id, revisionId, sub.applied_revision_id, `${today}T00:00:00+03:00`,
          `catalog-release:${release.id}:${sub.id}`, digestOf({ subscription_id: sub.id, release_id: release.id, entitlement_digest: entitlement.digest }),
          quote.due_now.currency, quote.due_now.exponent])
        await enqueueOutbox(client, { kind: 'fulfillment.enqueue', aggregate_id: orderId, dedupe_key: revisionId,
          payload: { order_id: orderId, subscription_id: sub.id, target_revision_id: revisionId } })
        return true
      })
      if (done) pushed++
    } catch (error) {
      failed++
      const code = String((error as { code?: string })?.code ?? (error instanceof Error ? error.message : 'catalog_push_failed')).slice(0, 200)
      console.error(JSON.stringify({ event: 'commercial_catalog_push_failed', subscription_id: candidate.id, release_id: release.id, error: code }))
    }
  }
  return { pushed, failed, candidates: candidates.length }
}
