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
 * Metrics are keyed by limit key, in the limit's own unit (Odoo's _nasq_count_usage).
 * The branch limit is the exception, as in Python: it is ALWAYS checked against the active plus pending extra
 * branches (never skipped by gates, lowered or not) and needs no usage sample. */
export async function assertDowngradeFitsUsage(client: Pick<PoolClient, 'query'>, input: {
  tenant_id: string | null; subscription_id: string; previous: Features; target: Features
  now?: Date
}) {
  if (input.tenant_id) await client.query('SELECT id FROM tenants WHERE id=$1 FOR SHARE', [input.tenant_id])
  const row = input.tenant_id ? (await client.query('SELECT observed_at,metrics,freshness,limit_gates FROM usage_snapshots WHERE tenant_id=$1 ORDER BY observed_at DESC,id DESC LIMIT 1 FOR SHARE', [input.tenant_id])).rows[0] : null
  const stored: Record<string, string[]> = row?.limit_gates ?? {}
  const keys = [...new Set([...Object.keys(input.previous), ...Object.keys(input.target)])].sort()
  const lowering = keys.filter(key => {
    const next = input.target[key]
    if (typeof next !== 'number' || key === BRANCH_LIMIT) return false
    const previous = input.previous[key]
    const lowered = previous === undefined || previous === null || (typeof previous === 'number' && next < previous)
    const gates = stored[key]
    // No stored gates: a reopen cannot be ruled out, so a key is checked when lowered or when any boolean flips to true.
    if (!Array.isArray(gates)) return lowered || Object.entries(input.target).some(([k, v]) => v === true && input.previous[k] !== true)
    if (closed(gates, input.target)) return false
    const reopened = closed(gates, input.previous) && gates.some(gate => input.target[gate] === true)
    return lowered || reopened
  })
  const branchLimit = input.target[BRANCH_LIMIT]
  if (typeof branchLimit === 'number') {
    const count = (await client.query("SELECT count(*)::int AS n FROM commercial_branches WHERE subscription_id=$1 AND kind='extra' AND state IN ('active','pending')", [input.subscription_id])).rows[0].n
    if (count > branchLimit) throw new CommercialHttpError('downgrade_below_usage', 422, BRANCH_LIMIT)
  }
  if (!lowering.length) return
  const now = input.now ?? new Date()
  for (const key of lowering) {
    const used = row?.metrics?.[key]
    if (!row || row.freshness !== 'fresh' || now.getTime() - new Date(row.observed_at).getTime() > FRESH_MS
      || typeof used !== 'number' || !Number.isFinite(used) || used < 0 || !Array.isArray(stored[key]))
      throw new CommercialHttpError('usage_unavailable', 409, key)
    if (used > (input.target[key] as number)) throw new CommercialHttpError('downgrade_below_usage', 422, key)
  }
}

const UNITS: Record<string, UsageMetric['unit']> = {
  'users.limit': 'users', 'storage.limit_mb': 'mebibytes', [BRANCH_LIMIT]: 'extra_branches',
  users: 'users', projects: 'projects', attachment_bytes: 'attachment_bytes', extra_branches: 'extra_branches',
}
/** Pre-Phase-3 samples stored operational counters (bytes for storage). When a sample has no limit-keyed
 * metric, the limit key is shown against its legacy counter, with the limit converted to that counter's unit. */
const LEGACY_COUNTERS: Record<string, { key: string; unit: UsageMetric['unit']; scale: number }> = {
  'users.limit': { key: 'users', unit: 'users', scale: 1 },
  'projects.max_projects': { key: 'projects', unit: 'projects', scale: 1 },
  'storage.limit_mb': { key: 'attachment_bytes', unit: 'attachment_bytes', scale: 1024 * 1024 },
  [BRANCH_LIMIT]: { key: 'extra_branches', unit: 'extra_branches', scale: 1 },
}

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
    const legacy = LEGACY_COUNTERS[key]
    const counter = !(key in stored) && legacy && legacy.key in stored ? legacy : { key, unit: UNITS[key] ?? 'count', scale: 1 }
    const v = freshness === 'unavailable' ? null : stored[counter.key]
    const used = typeof v === 'number' ? v : null
    const raw = input.limits[key]
    const limit = raw === null || raw === undefined ? null : raw * counter.scale
    return { key, used, limit, unit: counter.unit, reason: used === null ? 'not_collected' : null }
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
