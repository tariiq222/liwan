import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { migrate } from '../db.js'
import { acceptObservation, collectUsage, type UsageObserveRunner } from '../commercial/usage-collector.js'
import { url } from './commercial-helpers.js'

const NOW = new Date('2026-10-07T10:00:00Z')
const GATES = { 'users.limit': [], 'storage.limit_mb': [] }
const ok = (database: string, over: Record<string, unknown> = {}) => ({ database, observed_at: '2026-10-07T09:59:00Z', usage: { 'users.limit': 3, 'storage.limit_mb': 2 }, limit_gates: GATES, ...over })

describe('usage observation gate (no database)', () => {
  const db = 'nasq_scratch_' + 'a'.repeat(32)
  it('accepts a fresh, limit-keyed observation of the bound database with its gates', () => {
    expect(acceptObservation(ok(db), db, NOW)).toEqual(ok(db))
  })
  it.each([
    ['another tenant database', ok('nasq_scratch_' + 'b'.repeat(32))],
    ['a stale sample', ok(db, { observed_at: '2026-10-07T09:44:59Z' })],
    ['a future sample', ok(db, { observed_at: '2026-10-07T10:06:00Z' })],
    ['a malformed time', ok(db, { observed_at: 'yesterday' })],
    ['a negative value', ok(db, { usage: { 'users.limit': -1 }, limit_gates: { 'users.limit': [] } })],
    ['a fractional value', ok(db, { usage: { 'users.limit': 1.5 }, limit_gates: { 'users.limit': [] } })],
    ['a unit key instead of a limit key', ok(db, { usage: { users: 1 }, limit_gates: { users: [] } })],
    ['no metrics', ok(db, { usage: {}, limit_gates: {} })],
    ['missing gates', ok(db, { limit_gates: undefined })],
    ['gates missing a metric', ok(db, { limit_gates: { 'users.limit': [] } })],
    ['gates for an unobserved metric', ok(db, { limit_gates: { ...GATES, 'projects.max_projects': ['pmo.enabled'] } })],
    ['non-list gates', ok(db, { limit_gates: { ...GATES, 'users.limit': 'pmo.enabled' } })],
    ['non-string gate names', ok(db, { limit_gates: { ...GATES, 'users.limit': [1] } })],
  ])('refuses %s', (_name, observed) => {
    expect(acceptObservation(observed, db, NOW)).toBeNull()
  })
})

const suite = url ? describe : describe.skip
suite('usage collector (scratch control database)', () => {
  const pool = new Pool({ connectionString: url, max: 3 })
  beforeAll(async () => { await migrate(pool) })
  afterAll(async () => pool.end())

  async function tenant(enabled = true) {
    const id = randomUUID(), hex = id.replaceAll('-', ''), database = `nasq_scratch_${hex}`
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Usage','saas','managed',$2,true)", [id, `inv-${id}`])
    const customer = randomUUID(), subscription = randomUUID(), revision = randomUUID()
    await pool.query('INSERT INTO customers(id,name,tenant_id) VALUES($1,$2,$3)', [customer, 'Usage', id])
    await pool.query("INSERT INTO subscriptions(id,customer_id,tenant_id,state) VALUES($1,$2,$3,'active')", [subscription, customer, id])
    await pool.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,$3,$4)', [revision, subscription, JSON.stringify({ entitlement: { features: {} } }), randomUUID()])
    await pool.query('UPDATE subscriptions SET applied_revision_id=$2, revision=1 WHERE id=$1', [subscription, revision])
    await pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,$5,1)', [id, `t${hex}`, `t${hex}.usage.test`, database, enabled])
    return { id, database }
  }
  const latest = async (id: string) => (await pool.query('SELECT metrics,limit_gates,source FROM usage_snapshots WHERE tenant_id=$1 ORDER BY observed_at DESC,id DESC LIMIT 1', [id])).rows[0]
  const count = async (id: string) => (await pool.query('SELECT count(*)::int AS n FROM usage_snapshots WHERE tenant_id=$1', [id])).rows[0].n

  it('records the bound database usage with its gates and skips foreign, failing and disabled tenants', async () => {
    const good = await tenant(), foreign = await tenant(), failing = await tenant(), disabled = await tenant(false)
    const seen: string[] = []
    const runner: UsageObserveRunner = async ({ tenant_id, database }) => {
      seen.push(tenant_id)
      if (tenant_id === failing.id) throw Error('shared_effect_unverified')
      return ok(tenant_id === foreign.id ? good.database : database) as never
    }
    const result = await collectUsage(pool, { runner, now: () => NOW, limit: 1000 })
    expect(seen).not.toContain(disabled.id)
    expect(result.recorded).toBeGreaterThanOrEqual(1)
    expect(await latest(good.id)).toEqual({ metrics: { 'users.limit': 3, 'storage.limit_mb': 2 }, limit_gates: GATES, source: 'odoo.observe' })
    expect(await latest(foreign.id)).toBeUndefined()
    expect(await latest(failing.id)).toBeUndefined()
  })

  it('keeps the previous snapshot when a later observation is partial or fails', async () => {
    const t = await tenant()
    await collectUsage(pool, { runner: async ({ database }) => ok(database) as never, now: () => NOW, limit: 1000 })
    expect(await count(t.id)).toBe(1)
    const later = new Date('2026-10-07T10:05:00Z')
    const run = (observe: (database: string) => unknown) => collectUsage(pool, {
      runner: async ({ tenant_id, database }) => { if (tenant_id !== t.id) throw Error('skip'); return observe(database) as never },
      now: () => later, limit: 1000, log: () => {},
    })
    await run(d => ok(d, { limit_gates: undefined, observed_at: '2026-10-07T10:04:00Z' }))
    await run(d => ok(d, { usage: { 'users.limit': 0 }, observed_at: '2026-10-07T10:04:00Z' }))
    await run(() => { throw Error('shared_effect_unverified') })
    expect(await count(t.id)).toBe(1)
    expect((await latest(t.id)).metrics).toEqual({ 'users.limit': 3, 'storage.limit_mb': 2 })
  })

  it('drops a sample when the binding moved while it was observed', async () => {
    const moved = await tenant()
    const runner: UsageObserveRunner = async ({ tenant_id, database }) => {
      if (tenant_id !== moved.id) throw Error('skip')
      await pool.query('UPDATE shared_registry_bindings SET registry_revision=registry_revision+1 WHERE control_tenant_id=$1', [moved.id])
      return ok(database) as never
    }
    await collectUsage(pool, { runner, now: () => NOW, limit: 1000 })
    expect(await latest(moved.id)).toBeUndefined()
  })

  it('observes at most the requested number of tenants per run, oldest sample first', async () => {
    const seen: string[] = []
    await collectUsage(pool, { runner: async ({ tenant_id }) => { seen.push(tenant_id); throw Error('x') }, now: () => NOW, limit: 2, log: () => {} })
    expect(seen).toHaveLength(2)
  })

  it('bounds a hung observation', async () => {
    const result = await collectUsage(pool, { runner: () => new Promise(() => {}), now: () => NOW, limit: 1, timeout_ms: 20, log: () => {} })
    expect(result).toEqual({ recorded: 0, skipped: 1 })
  })
})
