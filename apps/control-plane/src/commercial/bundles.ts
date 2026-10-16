import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { compileEntitlements } from '@nasq/commercial-contracts/server'
import { bundleViewSchema, bundleCreateSchema, bundleEditSchema, lifecycleActionSchema, type BundleView, type BundleRevision, type CatalogRelease, type PlanRevision, type Price } from '@nasq/commercial-contracts'
import { transaction } from '../db.js'
import { audit, CommercialHttpError, digestOf, iso, lockRevision, nextVersion, pageParams, referenceCount, requireStatus, statusSql, toIssue, type CommercialActor, type Kind } from './lifecycle.js'
import { getRelease } from './catalog-releases.js'

export const BUNDLE_KIND: Kind = { table: 'bundle_revisions', parent: 'commercial_bundles', parentCol: 'bundle_id', label: 'bundle' }
type Row = Record<string, any>
const FIELDS = 'r.*, (SELECT count(*)::int FROM revision_references x WHERE x.revision_id=r.id) AS customer_count'

export function bundleContent(r: Row) {
  return { id: r.id, bundle_id: r.bundle_id, version: r.version, name: r.name, description: r.description, audience: r.audience,
    catalog_release_id: r.catalog_release_id, selections: r.selections, domain_limits: r.domain_limits, prices: r.prices }
}
export function bundleWire(row: Row, issues: { code: string; field?: string }[] = []): BundleView {
  return bundleViewSchema.parse({
    id: row.id, bundle_id: row.bundle_id, version: row.version, edit_revision: row.edit_revision, name: row.name,
    description: row.description, status: row.status, available: row.available, audience: row.audience,
    catalog_release_id: row.catalog_release_id, selections: row.selections, domain_limits: row.domain_limits, prices: row.prices,
    content_digest: row.content_digest, validated_digest: row.validated_digest, customer_count: row.customer_count ?? 0,
    created_at: iso(row.created_at), published_at: iso(row.published_at) ?? null, issues,
  })
}
export function bundleRevision(row: Row): BundleRevision {
  const { content_digest: _a, validated_digest: _b, customer_count: _c, created_at: _d, published_at: _e, issues: _f, ...rest } = bundleWire(row)
  return rest
}
export function priceIssues(prices: Price[], field = 'prices'): { code: string; field?: string }[] {
  const out: { code: string; field?: string }[] = []
  const seen = new Set<string>(); const currencies = new Set<string>()
  for (const p of prices) {
    const k = `${p.cadence.unit}:${p.cadence.count}`
    if (seen.has(k)) out.push({ code: 'duplicate_price_cadence', field })
    seen.add(k); currencies.add(p.amount.currency)
  }
  if (currencies.size > 1) out.push({ code: 'currency_mismatch', field })
  return out
}
/** Compile the bundle alone against its release; returns issues instead of throwing. */
export function bundleIssues(row: Row, release: CatalogRelease): { code: string; field?: string }[] {
  const issues = priceIssues(row.prices)
  if (row.audience.kind === 'customer' && !row.audience.customer_id) issues.push({ code: 'audience_invalid', field: 'audience' })
  const rev = bundleRevision(row)
  // Validation-only plan: every core limit is explicitly unlimited so a bundle is judged on its own content.
  const coreLimits = Object.fromEntries(release.applications.filter(a => !a.selectable).flatMap(a => a.features.filter(f => f.kind === 'limit').map(f => [f.key, null])))
  const plan = {
    id: '00000000-0000-4000-8000-0000000000aa', plan_id: 'x', version: 1, edit_revision: 1, name: 'validation', status: 'draft', available: false,
    audience: { kind: 'public' }, prices: [], term_months: 1, platform_limits: coreLimits, included_bundle_revision_ids: [row.id], optional_bundle_revision_ids: [],
    included_extra_branches: 0, extra_branch_prices: [], extra_branches_limit: null, policy_revision_id: row.id, currency: 'SAR',
    trial_days: 0, grace_days: 0, auto_suspend: false, auto_renew_allowed: false,
  } as unknown as PlanRevision
  try { compileEntitlements({ release, plan, bundles: [rev], terms: null }) } catch (e) { issues.push(toIssue(e)) }
  return issues
}
export async function loadRelease(client: Pool | PoolClient, id: string): Promise<CatalogRelease> {
  const r = await getRelease(client as Pool, id) as unknown as CatalogRelease
  return r
}
function audienceCustomer(a: { kind: string; customer_id?: string }) { return a.kind === 'customer' ? a.customer_id! : null }

export async function listBundles(pool: Pool, url: URL) {
  const p = pageParams(url)
  const customer = url.searchParams.get('customer_id')
  const where = [statusSql(p.status), "($1='' OR lower(r.name) LIKE '%'||$1||'%')", '($2::text IS NULL OR r.audience_customer_id IS NULL OR r.audience_customer_id=$2)']
  const result = await pool.query(`SELECT ${FIELDS}, count(*) OVER()::int AS total FROM bundle_revisions r WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC,r.id LIMIT $3 OFFSET $4`, [p.q, customer, p.limit, p.offset])
  return { items: result.rows.map(r => bundleWire(r)), total: result.rows[0]?.total ?? 0 }
}
export async function getBundle(pool: Pool, id: string, customerId: string | null) {
  const r = await pool.query(`SELECT ${FIELDS} FROM bundle_revisions r WHERE r.id=$1`, [id])
  if (!r.rowCount) throw new CommercialHttpError('bundle_missing', 404)
  const row = r.rows[0]
  if (customerId !== null && row.audience_customer_id !== null && row.audience_customer_id !== customerId) throw new CommercialHttpError('bundle_missing', 404)
  return bundleWire(row)
}
async function view(client: PoolClient, id: string) {
  const r = await client.query(`SELECT ${FIELDS} FROM bundle_revisions r WHERE r.id=$1`, [id])
  return bundleWire(r.rows[0])
}
async function ensureRelease(client: PoolClient, id: string) {
  const r = await client.query('SELECT 1 FROM catalog_releases WHERE id=$1', [id])
  if (!r.rowCount) throw new CommercialHttpError('release_missing', 422, 'catalog_release_id')
}
export function hasPrices(prices: Price[]) { return prices.length > 0 }

export async function createBundle(pool: Pool, actor: CommercialActor, value: unknown) {
  const input = bundleCreateSchema.parse(value)
  return transaction(pool, async client => {
    await ensureRelease(client, input.catalog_release_id)
    const bundleId = randomUUID(), id = randomUUID()
    await client.query('INSERT INTO commercial_bundles(id) VALUES($1)', [bundleId])
    const row = { id, bundle_id: bundleId, version: 1, ...input }
    await client.query(`INSERT INTO bundle_revisions(id,bundle_id,version,name,description,audience,audience_customer_id,catalog_release_id,selections,domain_limits,prices,content_digest)
      VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [id, bundleId, input.name, input.description, JSON.stringify(input.audience), audienceCustomer(input.audience),
      input.catalog_release_id, JSON.stringify(input.selections), JSON.stringify(input.domain_limits), JSON.stringify(input.prices), digestOf(bundleContent(row))])
    await audit(client, actor, 'bundle.created', id, input.reason ?? 'Create bundle draft', { bundle_id: bundleId, version: 1 })
    return view(client, id)
  })
}
type Action = 'edit' | 'delete' | 'validate' | 'publish' | 'withdraw' | 'restore' | 'revisions'
export async function mutateBundle(pool: Pool, actor: CommercialActor, id: string, action: Action, value: unknown, opts: { pricingGranted: boolean; pricingStepUp: boolean }) {
  const input: Record<string, any> = action === 'edit' ? bundleEditSchema.parse(value) : lifecycleActionSchema.parse(value)
  return transaction(pool, async client => {
    const row = await lockRevision(client, BUNDLE_KIND, id, input.edit_revision)
    const reason: string = input.reason
    if (action === 'revisions') {
      requireStatus(row, ['published'])
      const version = await nextVersion(client, BUNDLE_KIND, row.bundle_id)
      const nid = randomUUID()
      const copy = { ...row, id: nid, version }
      await client.query(`INSERT INTO bundle_revisions(id,bundle_id,version,name,description,audience,audience_customer_id,catalog_release_id,selections,domain_limits,prices,content_digest)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [nid, row.bundle_id, version, row.name, row.description, JSON.stringify(row.audience), row.audience_customer_id,
        row.catalog_release_id, JSON.stringify(row.selections), JSON.stringify(row.domain_limits), JSON.stringify(row.prices), digestOf(bundleContent(copy))])
      await audit(client, actor, 'bundle.revision_created', nid, reason, { from: id, version })
      return view(client, nid)
    }
    if (action === 'delete') {
      if (row.status !== 'draft' || (await referenceCount(client, id)) > 0) throw new CommercialHttpError('bundle_delete_forbidden', 409)
      await client.query('DELETE FROM bundle_revisions WHERE id=$1', [id])
      await audit(client, actor, 'bundle.deleted', id, reason, { digest: row.content_digest })
      return { deleted: true as const }
    }
    if (action === 'edit') {
      requireStatus(row, ['draft', 'validated'])
      if (digestOf(input.prices) !== digestOf(row.prices)) {
        if (!opts.pricingGranted) throw new CommercialHttpError('forbidden', 403)
        if (!opts.pricingStepUp) throw new CommercialHttpError('step_up_required', 403)
      }
      await ensureRelease(client, input.catalog_release_id)
      const next = { ...row, name: input.name, description: input.description, audience: input.audience, catalog_release_id: input.catalog_release_id, selections: input.selections, domain_limits: input.domain_limits, prices: input.prices }
      await client.query(`UPDATE bundle_revisions SET name=$2,description=$3,audience=$4,audience_customer_id=$5,catalog_release_id=$6,selections=$7,domain_limits=$8,prices=$9,content_digest=$10,validated_digest=NULL,status='draft',edit_revision=edit_revision+1 WHERE id=$1`,
        [id, input.name, input.description, JSON.stringify(input.audience), audienceCustomer(input.audience), input.catalog_release_id, JSON.stringify(input.selections), JSON.stringify(input.domain_limits), JSON.stringify(input.prices), digestOf(bundleContent(next))])
    } else if (action === 'validate' || action === 'publish') {
      requireStatus(row, [action === 'validate' ? 'draft' : 'validated'])
      if (action === 'publish' && row.validated_digest !== row.content_digest) throw new CommercialHttpError('review_required', 409)
      if (digestOf(bundleContent(row)) !== row.content_digest) throw new CommercialHttpError('content_digest_mismatch', 409)
      const release = await loadRelease(client, row.catalog_release_id)
      const issues = bundleIssues(row, release)
      const pol = await client.query("SELECT DISTINCT currency FROM pricing_policy_revisions WHERE status='approved'")
      const okCur = new Set(pol.rows.map((x: Row) => x.currency))
      if ((row.prices as Price[]).some(p => !okCur.has(p.amount.currency))) issues.push({ code: 'currency_not_supported', field: 'prices' })
      if ((row.prices as Price[]).some(p => p.amount.exponent !== 2)) issues.push({ code: 'currency_exponent_invalid', field: 'prices' })
      if (issues.length) throw new CommercialHttpError('invalid', 422, issues[0]!.field, issues)
      if (action === 'validate') await client.query("UPDATE bundle_revisions SET status='validated',validated_digest=content_digest,edit_revision=edit_revision+1 WHERE id=$1 AND edit_revision=$2", [id, row.edit_revision])
      else await client.query("UPDATE bundle_revisions SET status='published',available=true,published_at=now(),edit_revision=edit_revision+1 WHERE id=$1", [id])
    } else {
      requireStatus(row, ['published'])
      if (action === 'withdraw' && !row.available) throw new CommercialHttpError('transition_invalid', 409)
      if (action === 'restore' && row.available) throw new CommercialHttpError('transition_invalid', 409)
      await client.query('UPDATE bundle_revisions SET available=$2,edit_revision=edit_revision+1 WHERE id=$1', [id, action === 'restore'])
    }
    await audit(client, actor, `bundle.${action}`, id, reason ?? 'Save bundle draft', { edit_revision: row.edit_revision, next_edit_revision: row.edit_revision + 1, previous_digest: row.content_digest })
    return view(client, id)
  })
}
