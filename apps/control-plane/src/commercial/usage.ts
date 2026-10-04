import type { Pool, PoolClient } from 'pg'
import type { UsageSnapshot, UsageMetric } from '@nasq/commercial-contracts'
import { transaction } from '../db.js'
import { CommercialHttpError } from './lifecycle.js'

/** Both quote preview and acceptance check against the applied entitlement. */
export async function assertDowngradeFitsUsage(client: Pick<PoolClient, 'query'>, input: {
  tenant_id: string | null; subscription_id: string;
  previous: Record<string, boolean | number | null>; target: Record<string, boolean | number | null>; now?: Date
}) {
  const fields = [['users.limit','users',1], ['projects.max_projects','projects',1],
    ['storage.limit_mb','attachment_bytes',1024*1024], ['branches.extra_limit','extra_branches',1]] as const
  const lowering = fields.filter(([field]) => {
    const next = input.target[field] === undefined ? 0 : input.target[field]
    const previous = input.previous[field]
    return typeof next === 'number' && (previous === null || (typeof previous === 'number' && next < previous))
  })
  if (!lowering.length) return
  const now = input.now ?? new Date()
  if (input.tenant_id) await client.query('SELECT id FROM tenants WHERE id=$1 FOR SHARE', [input.tenant_id])
  const row = input.tenant_id ? (await client.query('SELECT observed_at,metrics,freshness FROM usage_snapshots WHERE tenant_id=$1 ORDER BY observed_at DESC,id DESC LIMIT 1 FOR SHARE', [input.tenant_id])).rows[0] : null
  for (const [field,key,unit] of lowering) {
    const used = row?.metrics?.[key]
    if (!row || row.freshness !== 'fresh' || now.getTime() - new Date(row.observed_at).getTime() > FRESH_MS
      || typeof used !== 'number' || !Number.isFinite(used) || used < 0)
      throw new CommercialHttpError('usage_unavailable', 409, field)
    let observed = used
    if (field === 'branches.extra_limit') {
      const count = (await client.query("SELECT count(*)::int AS n FROM commercial_branches WHERE subscription_id=$1 AND kind='extra' AND state IN ('active','pending')", [input.subscription_id])).rows[0].n
      observed = Math.max(observed, count)
    }
    const limit = typeof input.target[field] === 'number' ? input.target[field] as number : 0
    if (observed > limit * unit) throw new CommercialHttpError('downgrade_below_usage', 422, field)
  }
}

const FRESH_MS = 15 * 60 * 1000
const UNITS: Record<string, UsageMetric['unit']> = { users: 'users', projects: 'projects', attachment_bytes: 'attachment_bytes', extra_branches: 'extra_branches' }

export async function getUsage(pool: Pool, input: { tenant_id: string; limits: Record<string, number | null>; now?: Date }): Promise<UsageSnapshot> {
  const now = input.now ?? new Date()
  const r = await pool.query('SELECT observed_at, metrics, freshness FROM usage_snapshots WHERE tenant_id=$1 ORDER BY observed_at DESC, id DESC LIMIT 1', [input.tenant_id])
  const row = r.rows[0]
  const pr = await pool.query("SELECT r.snapshot->>'policy_revision_id' AS policy_revision_id FROM subscriptions s JOIN subscription_revisions r ON r.id=s.applied_revision_id WHERE s.tenant_id=$1 LIMIT 1", [input.tenant_id])
  const policy = pr.rows[0]?.policy_revision_id ?? '00000000-0000-4000-8000-000000000000'
  const observed = row ? (row.observed_at as Date) : null
  const stored: Record<string, number | null> = row?.metrics ?? {}
  const keys = Object.keys(input.limits)
  const freshness = !row || row.freshness === 'unavailable' ? 'unavailable'
    : row.freshness === 'stale' || now.getTime() - observed!.getTime() > FRESH_MS ? 'stale' : 'fresh'
  const metrics: UsageMetric[] = keys.map(key => {
    const v = freshness === 'unavailable' ? null : stored[key]
    const used = typeof v === 'number' ? v : null
    return { key, used, limit: input.limits[key] ?? null, unit: UNITS[key] ?? 'users', reason: used === null ? 'not_collected' : null }
  })
  return { tenant_id: input.tenant_id, observed_at: observed ? observed.toISOString() : null, policy_revision_id: policy, freshness, metrics }
}

export async function recordUsage(pool: Pool, input: { tenant_id: string; observed_at: Date; metrics: Record<string, number | null>; source: string }): Promise<void> {
  await transaction(pool, async client => {
    // Serializes ingestion with the transactional downgrade check, including the first sample.
    await client.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE', [input.tenant_id])
    await client.query(
      `INSERT INTO usage_snapshots(tenant_id, observed_at, freshness, metrics, source) VALUES($1,$2,'fresh',$3::jsonb,$4)`,
      [input.tenant_id, input.observed_at, JSON.stringify(input.metrics), input.source])
  })
}
