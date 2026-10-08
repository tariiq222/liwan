import type { Pool, PoolClient } from 'pg'
import type { UsageSnapshot, UsageMetric } from '@nasq/commercial-contracts'
import { transaction } from '../db.js'
import { CommercialHttpError } from './lifecycle.js'

type Features = Record<string, boolean | number | null>
const BRANCH_LIMIT = 'branches.extra_limit'
const FRESH_MS = 15 * 60 * 1000

/** Gate booleans of a limit key come from the stored observation (Odoo's limit_gates), the same source as the
 * Odoo effect. An app is closed when it has gates and every one is false; an absent gate key is not false. */
function closed(gates: string[], features: Features): boolean {
  return gates.length > 0 && gates.every(gate => features[gate] === false)
}

/** Both quote preview and acceptance check against the applied entitlement. Same rule as Python's
 * check_downgrade: a numeric target limit is CHECKED when lowered (absent/null previous = unlimited) or when its
 * app reopens (closed before, open now); it is SKIPPED when its app is closed in the target.
 * Metrics are keyed by limit key, in the limit's own unit (Odoo's _nasq_count_usage). */
export async function assertDowngradeFitsUsage(client: Pick<PoolClient, 'query'>, input: {
  tenant_id: string | null; subscription_id: string; previous: Features; target: Features
  release?: unknown; now?: Date
}) {
  if (input.tenant_id) await client.query('SELECT id FROM tenants WHERE id=$1 FOR SHARE', [input.tenant_id])
  const row = input.tenant_id ? (await client.query('SELECT observed_at,metrics,freshness,limit_gates FROM usage_snapshots WHERE tenant_id=$1 ORDER BY observed_at DESC,id DESC LIMIT 1 FOR SHARE', [input.tenant_id])).rows[0] : null
  const stored: Record<string, string[]> = row?.limit_gates ?? {}
  const keys = [...new Set([...Object.keys(input.previous), ...Object.keys(input.target)])].sort()
  const lowering = keys.filter(key => {
    const next = input.target[key]
    if (typeof next !== 'number') return false
    const previous = input.previous[key]
    const lowered = previous === undefined || previous === null || (typeof previous === 'number' && next < previous)
    const gates = stored[key]
    if (!Array.isArray(gates)) return lowered // no stored gates: a lowered key is checked and fails closed below
    if (closed(gates, input.target)) return false
    const reopened = closed(gates, input.previous) && gates.some(gate => input.target[gate] === true)
    return lowered || reopened
  })
  if (!lowering.length) return
  const now = input.now ?? new Date()
  for (const key of lowering) {
    const used = row?.metrics?.[key]
    if (!row || row.freshness !== 'fresh' || now.getTime() - new Date(row.observed_at).getTime() > FRESH_MS
      || typeof used !== 'number' || !Number.isFinite(used) || used < 0 || !Array.isArray(stored[key]))
      throw new CommercialHttpError('usage_unavailable', 409, key)
    let observed = used
    if (key === BRANCH_LIMIT) {
      const count = (await client.query("SELECT count(*)::int AS n FROM commercial_branches WHERE subscription_id=$1 AND kind='extra' AND state IN ('active','pending')", [input.subscription_id])).rows[0].n
      observed = Math.max(observed, count)
    }
    if (observed > (input.target[key] as number)) throw new CommercialHttpError('downgrade_below_usage', 422, key)
  }
}

const UNITS: Record<string, UsageMetric['unit']> = { 'users.limit': 'users', 'storage.limit_mb': 'mebibytes', [BRANCH_LIMIT]: 'extra_branches' }

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
    return { key, used, limit: input.limits[key] ?? null, unit: UNITS[key] ?? 'count', reason: used === null ? 'not_collected' : null }
  })
  return { tenant_id: input.tenant_id, observed_at: observed ? observed.toISOString() : null, policy_revision_id: policy, freshness, metrics }
}

export async function recordUsage(pool: Pool, input: { tenant_id: string; observed_at: Date; metrics: Record<string, number | null>; limit_gates?: Record<string, string[]>; source: string }): Promise<void> {
  await transaction(pool, async client => {
    // Serializes ingestion with the transactional downgrade check, including the first sample.
    await client.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE', [input.tenant_id])
    await client.query(
      `INSERT INTO usage_snapshots(tenant_id, observed_at, freshness, metrics, limit_gates, source) VALUES($1,$2,'fresh',$3::jsonb,$4::jsonb,$5)`,
      [input.tenant_id, input.observed_at, JSON.stringify(input.metrics), input.limit_gates ? JSON.stringify(input.limit_gates) : null, input.source])
  })
}
