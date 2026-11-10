import type { PoolClient } from 'pg'
import { paidStorageGb, paidUnits, type Quote } from '@liwan/commercial-contracts'
import { loadCustomerTerms } from './customer-terms.js'
import { policyWire } from './policies.js'
import { CommercialHttpError } from './lifecycle.js'
import { bundleRevision, loadRelease } from './bundles.js'
import { planRevision } from './plans.js'

// The shared quote-source helpers live here, a leaf both the quote layer and the free-base layer import, so neither imports the other.
const bad = (code: string, field: string, status = 422) => new CommercialHttpError(code, status, field, [{ code, field }])

/** Shared quote/acceptance loader: customer-specific terms can never cross customer boundaries. */
export async function loadQuoteSources(client: Pick<PoolClient, 'query'>, customerId: string, input: { plan_revision_id: string; bundle_revision_ids: string[]; terms_revision_id?: string | null }, sellable = true) {
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

export function pricingBaseline(quote: Quote, included: { extra_branches: number; users: number; storage_mb: number }) {
  // Persisted quotes do not include request kind. The full base line identifies
  // the target cycle: initial (including reselection) uses now; changes use renewal.
  const timing = quote.lines.find(l => l.key === 'base' && l.kind === 'base')?.timing
  const lines = quote.lines.filter(l => l.timing === timing && !l.key.endsWith(':delta'))
  const branch = lines.find(l => l.kind === 'branch')
  const users = lines.find(l => l.kind === 'users')
  const storage = lines.find(l => l.kind === 'storage')
  return { plan_revision_id: quote.plan_revision_id, bundle_revision_ids: quote.bundle_revision_ids,
    paid_extra_branches: paidUnits(quote.requested_extra_branches, included.extra_branches), base_minor: lines.find(l => l.kind === 'base')?.amount.minor ?? 0,
    paid_users: paidUnits(quote.requested_users, included.users), paid_storage_gb: paidStorageGb(quote.requested_storage_mb, included.storage_mb),
    bundle_minor: Object.fromEntries(lines.filter(l => l.kind === 'bundle').map(l => [l.source_revision_id, l.amount.minor])),
    branch_unit_minor: branch && branch.quantity ? branch.amount.minor / branch.quantity : 0,
    user_unit_minor: users && users.quantity ? users.amount.minor / users.quantity : 0,
    storage_unit_minor: storage && storage.quantity ? storage.amount.minor / storage.quantity : 0 }
}
