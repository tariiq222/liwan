import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { branchBillingCounts, type Branch, type BranchSummary } from '@nasq/commercial-contracts'
import { CommercialHttpError, iso } from './lifecycle.js'

type Db = Pool | PoolClient

const toBranch = (r: any): Branch => ({
  id: r.id, subscription_id: r.subscription_id, tenant_id: r.tenant_id ?? '', name: r.name, kind: r.kind,
  billing: r.billing, state: r.state, odoo_company_id: r.odoo_company_id ?? null, order_id: r.order_id ?? null,
  activated_at: r.activated_at ? String(iso(r.activated_at)) : null, archived_at: r.archived_at ? String(iso(r.archived_at)) : null,
})

async function allowances(db: Db, subscription_id: string): Promise<{ free: number; limit: number | null }> {
  const r = await db.query(
    `SELECT rv.snapshot FROM subscriptions s JOIN subscription_revisions rv ON rv.id=COALESCE(s.applied_revision_id,s.target_revision_id) WHERE s.id=$1`, [subscription_id])
  if (!r.rowCount) return { free: 0, limit: null }
  const snap = r.rows[0].snapshot ?? {}
  const free = Number(snap.included_extra_branches ?? 0)
  const lim = snap.entitlement?.features?.['branches.extra_limit'] ?? snap.entitlements?.features?.['branches.extra_limit']
  return { free: Number.isFinite(free) ? Math.max(0, free) : 0, limit: typeof lim === 'number' ? lim : null }
}

async function subscriptionBranches(db: Db, subscription_id: string): Promise<any[]> {
  const r = await db.query(
    `SELECT * FROM commercial_branches WHERE subscription_id=$1 ORDER BY (kind='hq') DESC, created_at, id`, [subscription_id])
  return r.rows
}

export async function listBranches(pool: Db, subscription_id: string): Promise<BranchSummary> {
  const rows = await subscriptionBranches(pool, subscription_id)
  const { free, limit } = await allowances(pool, subscription_id)
  const counts = branchBillingCounts(rows, free)
  return {
    items: rows.map(toBranch), total: rows.length, hq: 1,
    free_extra_used: counts.free_used, free_extra_allowed: free, paid: counts.paid, limit,
  }
}

export async function requestedExtraBranches(pool: Db, input: { subscription_id: string; add: number; archive: string[] }): Promise<number> {
  const rows = await subscriptionBranches(pool, input.subscription_id)
  for (const id of new Set(input.archive)) {
    const b = rows.find(x => x.id === id)
    if (!b || b.kind !== 'extra') throw new CommercialHttpError('branch_not_found', 404, 'archive')
  }
  const archiving = rows.filter(b => b.kind === 'extra' && (b.state === 'active' || b.state === 'pending') && new Set(input.archive).has(b.id)).length
  const current = rows.filter(b => b.kind === 'extra' && (b.state === 'active' || b.state === 'pending')).length
  return current + input.add - archiving
}

export async function reserveBranchesForOrder(client: PoolClient, input: {
  order_id: string; subscription_id: string; tenant_id: string | null; adds: { name: string }[]; quoted_paid: number; operation_id: string
}): Promise<Branch[]> {
  await client.query('SELECT id FROM subscriptions WHERE id=$1 FOR UPDATE', [input.subscription_id])
  const { free } = await allowances(client, input.subscription_id)
  const existing = await subscriptionBranches(client, input.subscription_id)
  let used = branchBillingCounts(existing, free).free_used
  const created: Branch[] = []
  for (const add of input.adds) {
    const billing = used < free ? 'free_extra' : 'paid'
    if (billing === 'free_extra') used++
    try {
      const r = await client.query(
        `INSERT INTO commercial_branches(id,subscription_id,tenant_id,name,kind,billing,state,order_id,operation_id)
         VALUES($1,$2,$3,$4,'extra',$5,'pending',$6,$7) RETURNING *`,
        [randomUUID(), input.subscription_id, input.tenant_id, add.name.trim(), billing, input.order_id, input.operation_id])
      created.push(toBranch(r.rows[0]))
    } catch (e: any) {
      if (e?.code === '23505') throw new CommercialHttpError('branch_name_taken', 409, 'name')
      throw e
    }
  }
  const after = branchBillingCounts(await subscriptionBranches(client, input.subscription_id), free)
  if (after.paid !== input.quoted_paid) throw new CommercialHttpError('requote_required', 409)
  return created
}

export async function archiveBranches(client: PoolClient, input: { subscription_id: string; ids: string[] }): Promise<Branch[]> {
  if (!input.ids.length) return []
  const r = await client.query(
    `UPDATE commercial_branches SET state='archived', archived_at=now()
     WHERE subscription_id=$1 AND kind='extra' AND id=ANY($2::uuid[]) AND state<>'archived' RETURNING *`,
    [input.subscription_id, input.ids])
  return r.rows.map(toBranch)
}

export async function activateBranches(client: PoolClient, input: { order_id: string; bindings: { branch_id: string; odoo_company_id: number }[] }): Promise<Branch[]> {
  const out: Branch[] = []
  for (const b of input.bindings) {
    const r = await client.query(
      `UPDATE commercial_branches SET state='active', odoo_company_id=$3, activated_at=now()
       WHERE id=$1 AND order_id=$2 AND state='pending' AND tenant_id IS NOT NULL RETURNING *`, [b.branch_id, input.order_id, b.odoo_company_id])
    if (!r.rowCount) throw new CommercialHttpError('branch_not_pending', 409)
    out.push(toBranch(r.rows[0]))
  }
  return out
}
