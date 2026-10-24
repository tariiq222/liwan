import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { planViewSchema, planCreateSchema, planEditSchema, lifecycleActionSchema, type PlanView, type PlanRevision, type Price } from '@webvue/commercial-contracts'
import { transaction } from '../db.js'
import { audit, CommercialHttpError, digestOf, iso, lockRevision, nextVersion, pageParams, referenceCount, requireStatus, statusSql, type CommercialActor, type Kind } from './lifecycle.js'
import { priceIssues, bundleRevision, loadRelease } from './bundles.js'
import { compileEntitlements, CommercialError } from '@webvue/commercial-contracts/server'

export const PLAN_KIND: Kind = { table: 'plan_revisions', parent: 'commercial_plans', parentCol: 'plan_id', label: 'plan' }
type Row = Record<string, any>
type Issue = { code: string; field?: string }
const FIELDS = 'r.*, (SELECT count(*)::int FROM revision_references x WHERE x.revision_id=r.id) AS customer_count'
const PLAN_COLS = ['name', 'audience', 'term_months', 'currency', 'prices', 'platform_limits', 'included_bundle_revision_ids', 'optional_bundle_revision_ids', 'included_extra_branches', 'extra_branch_prices', 'extra_branches_limit', 'included_users', 'included_storage_mb', 'user_prices', 'storage_prices', 'policy_revision_id', 'trial_days', 'grace_days', 'auto_suspend', 'auto_renew_allowed'] as const

export function planContent(r: Row) {
  return { id: r.id, plan_id: r.plan_id, version: r.version, ...Object.fromEntries(PLAN_COLS.map(k => [k, r[k]])) }
}
export function planWire(row: Row, issues: Issue[] = []): PlanView {
  return planViewSchema.parse({
    id: row.id, plan_id: row.plan_id, version: row.version, edit_revision: row.edit_revision, name: row.name, status: row.status,
    available: row.available, audience: row.audience, prices: row.prices, term_months: row.term_months, platform_limits: row.platform_limits,
    included_bundle_revision_ids: row.included_bundle_revision_ids, optional_bundle_revision_ids: row.optional_bundle_revision_ids,
    included_extra_branches: row.included_extra_branches, extra_branch_prices: row.extra_branch_prices, extra_branches_limit: row.extra_branches_limit,
    included_users: row.included_users, included_storage_mb: row.included_storage_mb, user_prices: row.user_prices, storage_prices: row.storage_prices,
    policy_revision_id: row.policy_revision_id, currency: row.currency, trial_days: row.trial_days, grace_days: row.grace_days,
    auto_suspend: row.auto_suspend, auto_renew_allowed: row.auto_renew_allowed,
    content_digest: row.content_digest, validated_digest: row.validated_digest, customer_count: row.customer_count ?? 0,
    created_at: iso(row.created_at), published_at: iso(row.published_at) ?? null, issues,
  })
}
export function planRevision(row: Row): PlanRevision {
  const { content_digest: _a, validated_digest: _b, customer_count: _c, created_at: _d, published_at: _e, issues: _f, ...rest } = planWire(row)
  return rest
}
const cadenceMonths = (c: { unit: string; count: number }) => c.unit === 'year' ? c.count * 12 : c.count
const isoExponent = (c: string) => { try { return new Intl.NumberFormat('en', { style: 'currency', currency: c }).resolvedOptions().maximumFractionDigits ?? 2 } catch { return 2 } }
const key = (p: Price) => `${p.cadence.unit}:${p.cadence.count}`

const DERIVED_LIMITS = ['branches.extra_limit', 'users.limit', 'storage.limit_mb']
// AI fair-use (owner decision 2026-10-25): `ai.messages.monthly: null` means unlimited, and that
// is intentional. The AI application is sold flat priced; the fair-use limit is a term of service,
// not a system value, so no hidden plan key is invented for it in this phase.
async function entitlementIssues(client: Pool | PoolClient, row: Row, bundleRows: Row[], releaseId: string | null, inc: string[]): Promise<Issue[]> {
  const out: Issue[] = []
  for (const k of Object.keys(row.platform_limits ?? {})) if (DERIVED_LIMITS.includes(k)) out.push({ code: 'platform_limit_derived', field: 'platform_limits' })
  if (out.length) return out
  if (!releaseId) releaseId = (await client.query('SELECT id FROM catalog_releases ORDER BY created_at DESC,id LIMIT 1')).rows[0]?.id ?? null
  if (!releaseId) return [{ code: 'release_missing', field: 'catalog_release_id' }]
  const release = await loadRelease(client, releaseId)
  const plan = planRevision(row)
  const bundles = bundleRows.map(bundleRevision)
  for (const set of [bundles, bundles.filter(b => inc.includes(b.id))]) {
    try { compileEntitlements({ release, plan, bundles: set, terms: null, quantities: { users: row.included_users, storage_mb: row.included_storage_mb } }) }
    catch (e) {
      if (!(e instanceof CommercialError)) throw e
      const field = e.field === 'quantities' ? 'included_users' : e.field
      out.push(field ? { code: e.code, field } : { code: e.code })
    }
  }
  return out
}
export async function planIssues(client: Pool | PoolClient, row: Row): Promise<Issue[]> {
  const issues: Issue[] = []
  const prices: Price[] = row.prices, branchPrices: Price[] = row.extra_branch_prices
  const userPrices: Price[] = row.user_prices ?? [], storagePrices: Price[] = row.storage_prices ?? []
  if (!prices.length) issues.push({ code: 'price_missing', field: 'prices' })
  issues.push(...priceIssues(prices, 'prices'), ...priceIssues(branchPrices, 'extra_branch_prices'),
    ...priceIssues(userPrices, 'user_prices'), ...priceIssues(storagePrices, 'storage_prices'))
  const allPrices = [...prices, ...branchPrices, ...userPrices, ...storagePrices]
  for (const p of allPrices) if (p.amount.currency !== row.currency) { issues.push({ code: 'currency_mismatch', field: 'prices' }); break }
  const exp = isoExponent(row.currency)
  if (allPrices.some(p => p.amount.exponent !== exp)) issues.push({ code: 'currency_exponent_invalid', field: 'prices' })
  const canBuyBranches = row.extra_branches_limit === null || row.extra_branches_limit > row.included_extra_branches
  if (row.extra_branches_limit !== null && row.extra_branches_limit < row.included_extra_branches) issues.push({ code: 'branch_limit_invalid', field: 'extra_branches_limit' })
  const branchKeys = new Set(branchPrices.map(key))
  const userKeys = new Set(userPrices.map(key))
  const storageKeys = new Set(storagePrices.map(key))
  for (const p of prices) {
    if (row.term_months % cadenceMonths(p.cadence) !== 0) issues.push({ code: 'term_not_multiple', field: 'term_months' })
    if (canBuyBranches && !branchKeys.has(key(p))) issues.push({ code: 'branch_price_missing', field: 'extra_branch_prices' })
    if (!userKeys.has(key(p))) issues.push({ code: 'unit_price_missing', field: 'user_prices' })
    if (!storageKeys.has(key(p))) issues.push({ code: 'unit_price_missing', field: 'storage_prices' })
  }
  const inc: string[] = row.included_bundle_revision_ids, opt: string[] = row.optional_bundle_revision_ids
  if (inc.some(id => opt.includes(id))) issues.push({ code: 'bundle_duplicated', field: 'optional_bundle_revision_ids' })
  const ids = [...new Set([...inc, ...opt])]
  if (ids.length) {
    const b = await client.query('SELECT id,status,available,audience_customer_id FROM bundle_revisions WHERE id=ANY($1::uuid[])', [ids])
    const by = new Map(b.rows.map((x: Row) => [x.id, x]))
    for (const id of ids) {
      const x = by.get(id) as Row | undefined
      const field = inc.includes(id) ? 'included_bundle_revision_ids' : 'optional_bundle_revision_ids'
      if (!x) { issues.push({ code: 'bundle_missing', field }); continue }
      if (x.status !== 'published' || !x.available) issues.push({ code: 'bundle_unavailable', field })
      if (x.audience_customer_id !== null && x.audience_customer_id !== row.audience_customer_id) issues.push({ code: 'bundle_audience_mismatch', field })
    }
    const cur = await client.query('SELECT * FROM bundle_revisions WHERE id=ANY($1::uuid[])', [ids])
    const rows = cur.rows as Row[]
    for (const r of rows) if ((r.prices as Price[]).some(p => p.amount.currency !== row.currency || p.amount.exponent !== exp)) { issues.push({ code: 'currency_mismatch', field: 'included_bundle_revision_ids' }); break }
    // Optional bundles are priced per offered cadence; included bundles are covered by the base price.
    for (const r of rows.filter(x => opt.includes(x.id))) {
      const have = new Set((r.prices as Price[]).map(key))
      if (prices.some(p => !have.has(key(p)))) { issues.push({ code: 'price_missing', field: 'optional_bundle_revision_ids' }); break }
    }
    const releases = new Set(rows.map(r => r.catalog_release_id))
    if (releases.size > 1) issues.push({ code: 'catalog_release_mismatch', field: 'included_bundle_revision_ids' })
    else if (rows.length === ids.length && releases.size === 1) issues.push(...await entitlementIssues(client, row, rows, [...releases][0] as string, inc))
  } else issues.push(...await entitlementIssues(client, row, [], null, inc))
  const pol = await client.query('SELECT currency FROM pricing_policy_revisions WHERE id=$1', [row.policy_revision_id])
  if (!pol.rowCount) issues.push({ code: 'policy_missing', field: 'policy_revision_id' })
  else if (pol.rows[0].currency !== row.currency) issues.push({ code: 'currency_not_supported', field: 'currency' })
  const seen = new Set<string>(); return issues.filter(i => { const k = `${i.code}:${i.field}`; if (seen.has(k)) return false; seen.add(k); return true })
}
const audienceCustomer = (a: { kind: string; customer_id?: string }) => a.kind === 'customer' ? a.customer_id! : null

export async function listPlans(pool: Pool, url: URL) {
  const p = pageParams(url)
  const customer = url.searchParams.get('customer_id')
  const r = await pool.query(`SELECT ${FIELDS}, count(*) OVER()::int AS total FROM plan_revisions r WHERE ${statusSql(p.status)} AND ($1='' OR lower(r.name) LIKE '%'||$1||'%') AND ($2::text IS NULL OR r.audience_customer_id IS NULL OR r.audience_customer_id=$2) ORDER BY r.created_at DESC,r.id LIMIT $3 OFFSET $4`, [p.q, customer, p.limit, p.offset])
  return { items: r.rows.map(x => planWire(x)), total: r.rows[0]?.total ?? 0 }
}
export async function getPlan(pool: Pool, id: string, customerId: string | null) {
  const r = await pool.query(`SELECT ${FIELDS} FROM plan_revisions r WHERE r.id=$1`, [id])
  if (!r.rowCount) throw new CommercialHttpError('plan_missing', 404)
  const row = r.rows[0]
  if (customerId !== null && row.audience_customer_id !== null && row.audience_customer_id !== customerId) throw new CommercialHttpError('plan_missing', 404)
  return planWire(row)
}
async function view(client: PoolClient, id: string) {
  const r = await client.query(`SELECT ${FIELDS} FROM plan_revisions r WHERE r.id=$1`, [id])
  return planWire(r.rows[0])
}
const j = JSON.stringify
const insertSql = `INSERT INTO plan_revisions(id,plan_id,version,name,audience,audience_customer_id,term_months,currency,prices,platform_limits,included_bundle_revision_ids,optional_bundle_revision_ids,included_extra_branches,extra_branch_prices,extra_branches_limit,included_users,included_storage_mb,user_prices,storage_prices,policy_revision_id,trial_days,grace_days,auto_suspend,auto_renew_allowed,content_digest)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`
const insertArgs = (id: string, planId: string, version: number, r: Row) => [id, planId, version, r.name, j(r.audience), audienceCustomer(r.audience), r.term_months, r.currency, j(r.prices), j(r.platform_limits),
  j(r.included_bundle_revision_ids), j(r.optional_bundle_revision_ids), r.included_extra_branches, j(r.extra_branch_prices), r.extra_branches_limit, r.included_users, r.included_storage_mb, j(r.user_prices), j(r.storage_prices), r.policy_revision_id, r.trial_days, r.grace_days, r.auto_suspend, r.auto_renew_allowed,
  digestOf(planContent({ ...r, id, plan_id: planId, version }))]

async function requirePolicy(client: PoolClient, id: string) {
  if (!(await client.query('SELECT 1 FROM pricing_policy_revisions WHERE id=$1', [id])).rowCount) throw new CommercialHttpError('invalid', 422, 'policy_revision_id', [{ code: 'policy_missing', field: 'policy_revision_id' }])
}
export async function createPlan(pool: Pool, actor: CommercialActor, value: unknown) {
  const input = planCreateSchema.parse(value)
  return transaction(pool, async client => {
    await requirePolicy(client, input.policy_revision_id)
    const planId = randomUUID(), id = randomUUID()
    await client.query('INSERT INTO commercial_plans(id) VALUES($1)', [planId])
    await client.query(insertSql, insertArgs(id, planId, 1, input))
    await audit(client, actor, 'plan.created', id, input.reason ?? 'Create plan draft', { plan_id: planId, version: 1 })
    return view(client, id)
  })
}
type Action = 'edit' | 'delete' | 'validate' | 'publish' | 'withdraw' | 'restore' | 'revisions'
export async function mutatePlan(pool: Pool, actor: CommercialActor, id: string, action: Action, value: unknown) {
  const input: Record<string, any> = action === 'edit' ? planEditSchema.parse(value) : lifecycleActionSchema.parse(value)
  return transaction(pool, async client => {
    const row = await lockRevision(client, PLAN_KIND, id, input.edit_revision)
    const reason: string = input.reason
    if (action === 'revisions') {
      requireStatus(row, ['published'])
      const version = await nextVersion(client, PLAN_KIND, row.plan_id)
      const nid = randomUUID()
      await client.query(insertSql, insertArgs(nid, row.plan_id, version, row))
      await audit(client, actor, 'plan.revision_created', nid, reason, { from: id, version })
      return view(client, nid)
    }
    if (action === 'delete') {
      if (row.status !== 'draft' || (await referenceCount(client, id)) > 0) throw new CommercialHttpError('plan_delete_forbidden', 409)
      await client.query('DELETE FROM plan_revisions WHERE id=$1', [id])
      await audit(client, actor, 'plan.deleted', id, reason, { digest: row.content_digest })
      return { deleted: true as const }
    }
    if (action === 'edit') {
      requireStatus(row, ['draft', 'validated'])
      await requirePolicy(client, input.policy_revision_id)
      const next = { ...row, ...Object.fromEntries(PLAN_COLS.map(k => [k, input[k]])) }
      await client.query(`UPDATE plan_revisions SET name=$2,audience=$3,audience_customer_id=$4,term_months=$5,currency=$6,prices=$7,platform_limits=$8,included_bundle_revision_ids=$9,optional_bundle_revision_ids=$10,included_extra_branches=$11,extra_branch_prices=$12,extra_branches_limit=$13,included_users=$14,included_storage_mb=$15,user_prices=$16,storage_prices=$17,policy_revision_id=$18,trial_days=$19,grace_days=$20,auto_suspend=$21,auto_renew_allowed=$22,content_digest=$23,validated_digest=NULL,status='draft',edit_revision=edit_revision+1 WHERE id=$1 AND edit_revision=$24`,
        [id, next.name, j(next.audience), audienceCustomer(next.audience), next.term_months, next.currency, j(next.prices), j(next.platform_limits), j(next.included_bundle_revision_ids), j(next.optional_bundle_revision_ids), next.included_extra_branches, j(next.extra_branch_prices), next.extra_branches_limit, next.included_users, next.included_storage_mb, j(next.user_prices), j(next.storage_prices), next.policy_revision_id, next.trial_days, next.grace_days, next.auto_suspend, next.auto_renew_allowed, digestOf(planContent(next)), row.edit_revision]).then(r => { if (!r.rowCount) throw new CommercialHttpError('revision_conflict', 409) })
    } else if (action === 'validate' || action === 'publish') {
      requireStatus(row, [action === 'validate' ? 'draft' : 'validated'])
      if (action === 'publish' && row.validated_digest !== row.content_digest) throw new CommercialHttpError('review_required', 409)
      if (digestOf(planContent(row)) !== row.content_digest) throw new CommercialHttpError('content_digest_mismatch', 409)
      const issues = await planIssues(client, row)
      if (issues.length) throw new CommercialHttpError('invalid', 422, issues[0]!.field, issues)
      if (action === 'validate') { if (!(await client.query("UPDATE plan_revisions SET status='validated',validated_digest=content_digest,edit_revision=edit_revision+1 WHERE id=$1 AND edit_revision=$2", [id, row.edit_revision])).rowCount) throw new CommercialHttpError('revision_conflict', 409) }
      else {
        await client.query("UPDATE plan_revisions SET status='published',available=true,published_at=now(),edit_revision=edit_revision+1 WHERE id=$1", [id])
        for (const b of new Set<string>([...row.included_bundle_revision_ids, ...row.optional_bundle_revision_ids]))
          await client.query("INSERT INTO revision_references(revision_id,revision_kind,referenced_by_kind,referenced_by_id) VALUES($1,'bundle','plan',$2) ON CONFLICT DO NOTHING", [b, id])
      }
    } else {
      requireStatus(row, ['published'])
      if ((action === 'withdraw') !== row.available) throw new CommercialHttpError('transition_invalid', 409)
      await client.query('UPDATE plan_revisions SET available=$2,edit_revision=edit_revision+1 WHERE id=$1', [id, action === 'restore'])
    }
    await audit(client, actor, `plan.${action}`, id, reason ?? 'Save plan draft', { edit_revision: row.edit_revision, next_edit_revision: row.edit_revision + 1, previous_digest: row.content_digest })
    return view(client, id)
  })
}
