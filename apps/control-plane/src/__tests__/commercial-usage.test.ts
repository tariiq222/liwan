import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { usageSnapshotSchema } from '@webvue/commercial-contracts'
import { getUsage, recordUsage } from '../commercial/usage.js'
import { migrate } from '../db.js'
import { url } from './commercial-helpers.js'

const now = new Date('2026-10-05T10:00:00Z')
const policy = '6f1c3d8e-0000-4000-8000-000000000001'
const limits = { 'users.limit': 10, 'projects.max_projects': 5, 'storage.limit_mb': 10, 'branches.extra_limit': 3 }

// Isolate the external PostgreSQL reads; exercise the real wire projection.
function source(metrics: Record<string, number | null>, freshness = 'fresh', observedAt = now) {
  return { query: async (sql: string, params: unknown[]) => {
    expect(params).toEqual(['tenant-a'])
    if (sql.includes('FROM usage_snapshots')) return { rows: [{ observed_at: observedAt, metrics, freshness }] }
    if (sql.includes('FROM subscriptions')) return { rows: [{ policy_revision_id: policy }] }
    throw new Error('Unexpected usage read')
  } } as unknown as Pool
}

describe('commercial usage wire projection', () => {
  it('shows operational counters against their entitlement limits in matching units', async () => {
    const result = await getUsage(source({ users: 3, projects: 2, attachment_bytes: 1048576, extra_branches: 1 }), { tenant_id: 'tenant-a', limits, now })
    expect(result.metrics).toEqual([
      { key: 'users.limit', used: 3, limit: 10, unit: 'users', reason: null },
      { key: 'projects.max_projects', used: 2, limit: 5, unit: 'projects', reason: null },
      { key: 'storage.limit_mb', used: 1048576, limit: 10485760, unit: 'attachment_bytes', reason: null },
      { key: 'branches.extra_limit', used: 1, limit: 3, unit: 'extra_branches', reason: null },
    ])
    expect(usageSnapshotSchema.parse(result).policy_revision_id).toBe(policy)
  })

  it('preserves observed zero, unknown values, and unlimited storage', async () => {
    const result = await getUsage(source({ users: 0, projects: null, attachment_bytes: 0 }), {
      tenant_id: 'tenant-a', limits: { ...limits, 'storage.limit_mb': null }, now,
    })
    expect(result.metrics).toEqual([
      { key: 'users.limit', used: 0, limit: 10, unit: 'users', reason: null },
      { key: 'projects.max_projects', used: null, limit: 5, unit: 'projects', reason: 'not_collected' },
      { key: 'storage.limit_mb', used: 0, limit: null, unit: 'attachment_bytes', reason: null },
      { key: 'branches.extra_limit', used: null, limit: 3, unit: 'extra_branches', reason: 'not_collected' },
    ])
    expect(usageSnapshotSchema.safeParse(result).success).toBe(true)
  })

  it('retains stale observed figures and suppresses unavailable figures', async () => {
    const metrics = { users: 3, projects: 2, attachment_bytes: 1048576, extra_branches: 1 }
    const stale = await getUsage(source(metrics, 'fresh', new Date('2026-10-05T09:44:59Z')), { tenant_id: 'tenant-a', limits, now })
    expect(stale.freshness).toBe('stale')
    expect(stale.metrics.map(metric => metric.used)).toEqual([3, 2, 1048576, 1])
    const unavailable = await getUsage(source(metrics, 'unavailable'), { tenant_id: 'tenant-a', limits, now })
    expect(unavailable.freshness).toBe('unavailable')
    expect(unavailable.metrics.every(metric => metric.used === null && metric.reason === 'not_collected')).toBe(true)
  })

  it('keeps limit-keyed samples in the limit unit without legacy conversion', async () => {
    const result = await getUsage(source({ 'users.limit': 3, 'projects.max_projects': 2, 'storage.limit_mb': 1, 'branches.extra_limit': 1 }), { tenant_id: 'tenant-a', limits, now })
    expect(result.metrics).toEqual([
      { key: 'users.limit', used: 3, limit: 10, unit: 'users', reason: null },
      { key: 'projects.max_projects', used: 2, limit: 5, unit: 'count', reason: null },
      { key: 'storage.limit_mb', used: 1, limit: 10, unit: 'mebibytes', reason: null },
      { key: 'branches.extra_limit', used: 1, limit: 3, unit: 'extra_branches', reason: null },
    ])
    expect(usageSnapshotSchema.safeParse(result).success).toBe(true)
  })

  it('supports existing counter-key callers without converting byte limits twice', async () => {
    const result = await getUsage(source({ users: 3, attachment_bytes: 1048576 }), {
      tenant_id: 'tenant-a', limits: { users: 10, attachment_bytes: 2097152 }, now,
    })
    expect(result.metrics).toEqual([
      { key: 'users', used: 3, limit: 10, unit: 'users', reason: null },
      { key: 'attachment_bytes', used: 1048576, limit: 2097152, unit: 'attachment_bytes', reason: null },
    ])
  })
})

const live = url ? describe : describe.skip
live('usage persisted on isolated PostgreSQL', () => {
  const pool = new Pool({ connectionString: url, max: 5 })
  beforeAll(async () => { await migrate(pool) })
  afterAll(async () => { await pool.end() })
  async function tenant() {
    const id = randomUUID()
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Usage','saas','managed',$2,true)", [id, `usage-${id}`])
    return id
  }
  it('projects only the newest sample of the requested tenant with byte limits', async () => {
    const first = await tenant(), second = await tenant()
    await recordUsage(pool, { tenant_id: first, observed_at: new Date('2026-10-05T09:59:00Z'), metrics: { users: 1 }, source: 'regression' })
    await recordUsage(pool, { tenant_id: first, observed_at: now, metrics: { users: 3, projects: 2, attachment_bytes: 1048576, extra_branches: 1 }, source: 'regression' })
    await recordUsage(pool, { tenant_id: second, observed_at: new Date('2026-10-05T10:01:00Z'), metrics: { users: 999 }, source: 'regression' })
    const result = await getUsage(pool, { tenant_id: first, limits, now })
    expect(result.metrics.map(metric => metric.used)).toEqual([3, 2, 1048576, 1])
    expect(result.metrics[2]).toMatchObject({ limit: 10485760, unit: 'attachment_bytes' })
    expect(result.observed_at).toBe('2026-10-05T10:00:00.000Z')
    expect(usageSnapshotSchema.safeParse(result).success).toBe(true)
  })
  it('does not invent a zero measurement for a tenant with no source sample', async () => {
    const result = await getUsage(pool, { tenant_id: await tenant(), limits, now })
    expect(result.freshness).toBe('unavailable')
    expect(result.observed_at).toBeNull()
    expect(result.metrics.every(metric => metric.used === null)).toBe(true)
  })
})
