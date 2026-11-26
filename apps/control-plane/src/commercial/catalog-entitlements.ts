import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { AI_ENTITLEMENT_KEYS, riyadhDate, USERS_LIMIT_KEY, type BundleRevision, type CatalogApplication, type CatalogRelease, type CustomerTermsRevision, type EntitlementSnapshot, type PlanRevision } from '@liwan/commercial-contracts'
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
 * the recompile can add one. A release that no longer carries what the subscription owns refuses to compile.
 * Renewal keeps the pinned entitlement so billing does not break, and writes the same visible refusal the push
 * counts as a failure: returning the pin is not "no change".
 */
const INCOMPATIBLE_ACTION = 'catalog_release.entitlement_incompatible'
/** Platform limits the compiler derives itself. Copying one onto the pinned plan is `platform_limit_derived`, not a fill. */
const DERIVED_PLATFORM_KEYS = new Set<string>([USERS_LIMIT_KEY, 'storage.limit_mb', 'branches.extra_limit', ...AI_ENTITLEMENT_KEYS])

/**
 * A digest also covers the release id and the compiler version. Neither is a delivery: only a different feature map is.
 */
export function entitlementFeaturesChanged(previous: EntitlementSnapshot['features'] | undefined, next: EntitlementSnapshot['features']): boolean {
  const before = previous ?? {}
  const keys = new Set([...Object.keys(before), ...Object.keys(next)])
  for (const key of keys) if (before[key] !== next[key]) return true
  return false
}

/**
 * The pinned plan was published against an older release, so it may not name a platform key the latest release requires.
 * This recompile only: copy that key from the entitlement the subscription already holds, when the value is a number or
 * null. A key the previous entitlement does not have is left missing, and the compiler still refuses it.
 */
function planForRecompile(plan: PlanRevision, release: CatalogRelease, previous: EntitlementSnapshot['features'] | undefined): PlanRevision {
  if (!previous) return plan
  const limits = { ...plan.platform_limits }
  let filled = false
  for (const app of release.applications) {
    if (app.selectable) continue
    for (const feature of app.features) {
      if (feature.kind !== 'limit' || DERIVED_PLATFORM_KEYS.has(feature.key) || Object.hasOwn(limits, feature.key)) continue
      const value = previous[feature.key]
      if (typeof value !== 'number' && value !== null) continue
      limits[feature.key] = value
      filled = true
    }
  }
  return filled ? { ...plan, platform_limits: limits } : plan
}

export async function recordEntitlementIncompatibility(db: Pick<Pool | PoolClient, 'query'>, input: {
  subscriptionId: string; code: string; releaseId: string; used?: number
}) {
  await db.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)', [
    randomUUID(), 'system:catalog', INCOMPATIBLE_ACTION, input.subscriptionId, input.code,
    JSON.stringify({ release_id: input.releaseId, subscription_id: input.subscriptionId, code: input.code,
      ...(input.used === undefined ? {} : { used: input.used }) }),
  ])
}

export async function recompiledEntitlementOn(client: Pick<PoolClient, 'query'>, sources: CompileSources,
  quantities: { users: number; storage_mb: number }, extraBranches: number | undefined,
  pinned: EntitlementSnapshot | undefined, subject: string,
  options?: { onIncompatible?: 'throw' | 'pin' }): Promise<EntitlementSnapshot> {
  const latest = await latestPublishedRelease(client)
  if (!latest) throw new CommercialHttpError('release_missing', 422, 'catalog_release_id')
  const against = latest.id === sources.release.id ? sources
    : { ...sources, release: latest, bundles: sources.bundles.map(b => ({ ...b, catalog_release_id: latest.id })) }
  try {
    return compilePurchasedEntitlement({ ...against, plan: planForRecompile(against.plan, against.release, pinned?.features), quantities, extraBranches })
  } catch (error) {
    if (!(error instanceof CommercialError) || !pinned) throw error
    // The push must not see the pin as an equal digest. Renewal keeps it, and the refusal is a row, not only a log.
    if (options?.onIncompatible === 'throw') throw error
    const subscriptionId = subject.startsWith('subscription ') ? subject.slice('subscription '.length) : subject
    await recordEntitlementIncompatibility(client, { subscriptionId, code: error.code, releaseId: latest.id })
    console.error(JSON.stringify({ event: 'commercial_entitlement_recompile_fallback', subject, error: error.code, release: latest.id }))
    return pinned
  }
}

/** Keys the usage check may treat as a downgrade: applications the subscription owns, including a limit the release dropped. */
export function ownedEntitlementKeys(release: Pick<CatalogRelease, 'applications'>, bundles: Pick<BundleRevision, 'selections'>[],
  previous: EntitlementSnapshot['features']): string[] {
  const selected = new Set(bundles.flatMap(bundle => bundle.selections.map(selection => selection.app_id)))
  const owned = (app: CatalogApplication) => !app.selectable || selected.has(app.id)
    || app.features.some(feature => feature.kind === 'boolean' && previous[feature.key] === true)
  const keys = new Set<string>()
  for (const app of release.applications) if (owned(app)) for (const feature of app.features) keys.add(feature.key)
  for (const [key, value] of Object.entries(previous)) {
    if (typeof value !== 'number') continue
    const app = release.applications.find(candidate => candidate.features.some(feature => feature.key === key))
    if (!app || owned(app)) keys.add(key)
  }
  return [...keys]
}

/**
 * A catalog follow is not a change the customer bought. The order keeps this key prefix so `pendingChangeRefusal`
 * and quote acceptance ignore it; a paid `change` or `renewal` key does not match. `target_revision_id` stays null.
 */
export const CATALOG_FOLLOW_KEY_PREFIX = 'catalog-release:'

export function isCatalogFollowKey(key: string | null | undefined): boolean {
  return typeof key === 'string' && key.startsWith(CATALOG_FOLLOW_KEY_PREFIX)
}

/**
 * The follow may still be delivered while the subscription target stays null, and only while the applied revision
 * is the one the follow was computed from. A paid change that has taken the target since, or moved what is applied,
 * is stale and must not be overwritten.
 */
export function catalogFollowMayDeliver(order: {
  idempotency_key?: string | null
  subscription_target?: string | null
  applied_revision_id?: string | null
  expected_applied_revision_id?: string | null
}): boolean {
  return isCatalogFollowKey(order.idempotency_key) && !order.subscription_target
    && !!order.applied_revision_id && order.applied_revision_id === order.expected_applied_revision_id
}

/**
 * Delivers the latest release to every subscription that owns a workspace: each one whose recomputed feature map
 * differs from its applied revision gets a new revision and a zero-due follow order, and the existing
 * fulfilment path queues the reconfigure job for it — the tenant write stays in that one path. Nothing is granted:
 * the recompile names exactly the revisions the snapshot owns, so an application the release adds is never added to
 * `bundle_revision_ids` (its keys stay closed). The follow does not set `target_revision_id` and its order key is
 * not a customer change in flight. Idempotent: a subscription whose entitlement is current, or that
 * already carries a pending revision or order, is not a candidate. An incompatible recompile is a failure, not an
 * unchanged entitlement: no revision and no order, and the refusal is recorded where the publish response can name it.
 */
export type CatalogPushFailure = { subscription_id: string; code: string; field?: string; used?: number }

function pushFailure(subscriptionId: string, error: unknown): CatalogPushFailure {
  const coded = error as { code?: string; field?: string; detail?: { used?: string } }
  const code = String(coded?.code ?? (error instanceof Error ? error.message : 'catalog_push_failed')).slice(0, 200)
  const used = coded?.detail?.used
  return { subscription_id: subscriptionId, code, ...(coded?.field ? { field: coded.field } : {}),
    ...(used !== undefined && Number.isFinite(Number(used)) ? { used: Number(used) } : {}) }
}

export async function pushCatalogEntitlement(pool: Pool, release: Pick<CatalogRelease, 'id'>, { now = new Date() }: { now?: Date } = {}) {
  // The predicates are the ones a change order may be written under: the same rules `acceptQuoteOn` enforces per
  // customer, applied in bulk. A subscription whose period already ended renews into the release instead.
  let pushed = 0, failed = 0, failures: CatalogPushFailure[] = []
  let candidates: { id: string; customer_id: string; revision: number; snapshot: Record<string, any> }[] = []
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
    return { pushed, failed, candidates: 0, failures }
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
        // A catalog follow buys nothing. Renewal is the invoice, and it prices an owned add-on from the latest published revision; this quote keeps the revision the snapshot names.
        const policy = (await client.query('SELECT * FROM pricing_policy_revisions WHERE id=$1', [snapshot.policy_revision_id])).rows[0]
        if (!policy) throw new Error('pinned_policy_missing')
        sources.policy = policyWire(policy)
        const pricing = await pricingOf(client, snapshot)
        const { extra_branches: extraBranches, ...quantities } = purchasedQuantities(sources.plan, snapshot, pricing)
        // A normal entitlement stores the plan ceiling, not the purchased count. Overwriting it (null → 0) is not a catalog change.
        const entitlement = await recompiledEntitlementOn(client, sources, quantities, snapshot.trial_end ? extraBranches : undefined, snapshot.entitlement, subject, { onIncompatible: 'throw' })
        // A compiler-version or release-id change alone is not a delivery: it would open a zero-due order and block cancel and renewal.
        if (!entitlementFeaturesChanged(snapshot.entitlement.features, entitlement.features)) return false
        // A lowered or removed limit below current use is refused here, naming the count, instead of a delivery that would block the tenant.
        await assertDowngradeFitsUsage(client, { tenant_id: sub.tenant_id, subscription_id: sub.id,
          previous: snapshot.entitlement.features ?? {}, target: entitlement.features, now,
          ownedKeys: ownedEntitlementKeys(sources.release, sources.bundles, snapshot.entitlement.features ?? {}) })
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
        // The revision guard refuses a revision-only write. Occupy sub.revision+1, then clear the target in the same
        // transaction so a catalog follow is not a customer change in flight. The committed row has a null target.
        await client.query('UPDATE subscriptions SET target_revision_id=$2,revision=revision+1 WHERE id=$1', [sub.id, revisionId])
        await client.query('UPDATE subscriptions SET target_revision_id=NULL,revision=revision+1 WHERE id=$1 AND target_revision_id=$2', [sub.id, revisionId])
        await client.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,expected_applied_revision_id,
          payment_state,fulfillment_state,effective_at,idempotency_key,request_digest,due_now_minor,currency,exponent)
          VALUES($1,$2,$3,'change',$4,$5,$6,'not_required','queued',$7,$8,$9,0,$10,$11)`,
        [orderId, sub.customer_id, sub.id, quote.id, revisionId, sub.applied_revision_id, `${today}T00:00:00+03:00`,
          `${CATALOG_FOLLOW_KEY_PREFIX}${release.id}:${sub.id}`, digestOf({ subscription_id: sub.id, release_id: release.id, entitlement_digest: entitlement.digest }),
          quote.due_now.currency, quote.due_now.exponent])
        await enqueueOutbox(client, { kind: 'fulfillment.enqueue', aggregate_id: orderId, dedupe_key: revisionId,
          payload: { order_id: orderId, subscription_id: sub.id, target_revision_id: revisionId } })
        return true
      })
      if (done) pushed++
    } catch (error) {
      failed++
      const failure = pushFailure(candidate.id, error)
      failures.push(failure)
      console.error(JSON.stringify({ event: 'commercial_catalog_push_failed', subscription_id: candidate.id, release_id: release.id, error: failure.code }))
      // Outside the rolled-back order transaction: the refusal stays visible after the release is already published.
      await recordEntitlementIncompatibility(pool, { subscriptionId: candidate.id, code: failure.code, releaseId: release.id, used: failure.used })
    }
  }
  return { pushed, failed, candidates: candidates.length, failures }
}
