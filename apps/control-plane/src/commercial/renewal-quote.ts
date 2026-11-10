import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { computeQuote } from '@liwan/commercial-contracts/server'
import { loadRelease } from './bundles.js'
import { compilePurchasedEntitlement } from './free-base.js'
import { policyWire } from './policies.js'
import { loadQuoteSources, pricingOf } from './quote-sources.js'

/** Notices and invoice creation price the same cycle with the same pinned sources. */
export async function quoteRenewal(client: Pick<PoolClient, 'query'>, sub: Record<string, any>, snapshot: Record<string, any>, period: { start: string; end: string }, now: Date) {
  const sources = await loadQuoteSources(client, sub.customer_id, {
    plan_revision_id: snapshot.plan_revision_id,
    bundle_revision_ids: snapshot.bundle_revision_ids,
    terms_revision_id: snapshot.terms_revision_id,
  }, false)
  if (!snapshot.terms_revision_id) sources.terms = null
  const policy = (await client.query('SELECT * FROM pricing_policy_revisions WHERE id=$1', [snapshot.policy_revision_id])).rows[0]
  if (!policy) throw new Error('pinned_policy_missing')
  sources.policy = policyWire(policy)
  const pricing = await pricingOf(client, snapshot)
  const converting = sub.trial_ends_at !== null && sub.trial_outcome === 'converted'
  const extraBranches = Number(snapshot.included_extra_branches) + pricing.paid_extra_branches
  const quantities = { users: sources.plan.included_users + pricing.paid_users, storage_mb: sources.plan.included_storage_mb + pricing.paid_storage_gb * 1024 }
  const entitlement = converting ? compilePurchasedEntitlement({ ...sources,
    release: await loadRelease(client, snapshot.entitlement.catalog_release_id), quantities, extraBranches }) : snapshot.entitlement
  const quote = computeQuote({ ...sources, kind: 'new', cadence: snapshot.cadence,
    requested_extra_branches: extraBranches, requested_users: quantities.users, requested_storage_mb: quantities.storage_mb,
    paid_through: sub.trial_paid_through ?? undefined, effective_date: period.start, period,
    ids: { id: randomUUID(), customer_id: sub.customer_id, subscription_id: sub.id, expected_subscription_revision: sub.revision },
    expires_at: new Date(now.getTime() + 30 * 60_000).toISOString(), entitlement_digest: entitlement.digest })
  return { quote, entitlement, converting, autoRenewAllowed: sources.plan.auto_renew_allowed }
}
