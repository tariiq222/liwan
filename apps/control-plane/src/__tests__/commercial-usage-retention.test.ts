import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { assertDowngradeFitsUsage, getUsage, recordUsage, USAGE_SNAPSHOT_RETENTION_DAYS } from '../commercial/usage.js'
import { migrate } from '../db.js'
import { url } from './commercial-helpers.js'

const suite = url ? describe : describe.skip
const DAY = 86_400_000

suite('usage sample retention (AUDIT-029)', () => {
  const pool = new Pool({ connectionString: url, max: 4 })
  beforeAll(async () => { await migrate(pool) })
  afterAll(async () => { await pool.end() })

  async function tenant() {
    const id = randomUUID()
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Usage retention','saas','dedicated_managed',$2,true)", [id, `inv-${id}`])
    return id
  }
  const sample = (tenant_id: string, ageDays: number, users: number) => recordUsage(pool, { tenant_id, observed_at: new Date(Date.now() - ageDays * DAY), metrics: { 'users.limit': users }, limit_gates: { 'users.limit': [] }, source: 'test' })
  const ages = async (tenant_id: string) => (await pool.query('SELECT (metrics->>$2)::int AS users FROM usage_snapshots WHERE tenant_id=$1 ORDER BY observed_at', [tenant_id, 'users.limit'])).rows.map(r => r.users)

  it('drops samples older than the window and keeps the newer ones', async () => {
    const t = await tenant()
    await sample(t, USAGE_SNAPSHOT_RETENTION_DAYS + 10, 1)
    await sample(t, USAGE_SNAPSHOT_RETENTION_DAYS + 5, 2)
    await sample(t, 3, 3)
    await sample(t, 0, 4)
    expect(await ages(t)).toEqual([3, 4])
  })
  it('never deletes the latest sample of a tenant, however old, and the readers still use it', async () => {
    const t = await tenant()
    await sample(t, USAGE_SNAPSHOT_RETENTION_DAYS + 60, 7)
    await sample(t, USAGE_SNAPSHOT_RETENTION_DAYS + 90, 9) // an older observation arriving late is not the latest
    expect(await ages(t)).toEqual([7])
    const usage = await getUsage(pool, { tenant_id: t, limits: { 'users.limit': 10 } })
    expect(usage.freshness).toBe('stale')
    expect(usage.metrics).toEqual([{ key: 'users.limit', used: 7, limit: 10, unit: 'users', reason: null }])
  })
  it("pruning one tenant leaves another tenant's history alone", async () => {
    const a = await tenant(), b = await tenant()
    await sample(b, USAGE_SNAPSHOT_RETENTION_DAYS + 20, 5)
    await sample(a, USAGE_SNAPSHOT_RETENTION_DAYS + 20, 1)
    await sample(a, 0, 2)
    expect(await ages(a)).toEqual([2])
    expect(await ages(b)).toEqual([5])
  })
  it('the downgrade check reads the same latest sample after pruning', async () => {
    const t = await tenant()
    await sample(t, USAGE_SNAPSHOT_RETENTION_DAYS + 5, 50)
    await sample(t, 0, 3)
    const client = await pool.connect()
    try {
      const check = (target: number) => assertDowngradeFitsUsage(client, { tenant_id: t, subscription_id: randomUUID(), previous: { 'users.limit': 10 }, target: { 'users.limit': target } })
      await expect(check(5)).resolves.toBeUndefined()
      await expect(check(2)).rejects.toMatchObject({ code: 'downgrade_below_usage' })
    } finally { client.release() }
  })
  it('serves the latest-per-tenant query from the index', async () => {
    const t = await tenant()
    await sample(t, 0, 1)
    const indexes = (await pool.query("SELECT indexname FROM pg_indexes WHERE tablename='usage_snapshots'")).rows.map(r => r.indexname)
    expect(indexes).toContain('usage_snapshots_latest_idx')
    expect(indexes).not.toContain('usage_snapshots_tenant_idx')
    const def = (await pool.query("SELECT indexdef FROM pg_indexes WHERE indexname='usage_snapshots_latest_idx'")).rows[0].indexdef
    expect(def).toContain('(tenant_id, observed_at DESC, id DESC)')
  })
})
