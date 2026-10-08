import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { migrate } from '../db.js'
import { acceptObservation, collectUsage, type UsageObserveRunner } from '../commercial/usage-collector.js'
import { REGISTRY_ADVISORY_LOCK } from '../shared/registry-store.js'
import { url } from './commercial-helpers.js'

const NOW = new Date('2026-10-07T10:00:00Z')
const GATES = { 'users.limit': [], 'storage.limit_mb': [], 'branches.extra_limit': [] }
const USAGE = { 'users.limit': 3, 'storage.limit_mb': 2, 'branches.extra_limit': 0 }
const ok = (database: string, over: Record<string, unknown> = {}) => ({ database, observed_at: '2026-10-07T09:59:00Z', usage: USAGE, limit_gates: GATES, ...over })

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
    ['a negative value', ok(db, { usage: { ...USAGE, 'users.limit': -1 } })],
    ['a fractional value', ok(db, { usage: { ...USAGE, 'users.limit': 1.5 } })],
    ['a unit key instead of a limit key', ok(db, { usage: { ...USAGE, users: 1 }, limit_gates: { ...GATES, users: [] } })],
    ['no metrics', ok(db, { usage: {}, limit_gates: {} })],
    ['a required metric missing', ok(db, { usage: { 'users.limit': 3, 'storage.limit_mb': 2 }, limit_gates: { 'users.limit': [], 'storage.limit_mb': [] } })],
    ['missing gates', ok(db, { limit_gates: undefined })],
    ['gates missing a metric', ok(db, { limit_gates: { 'users.limit': [], 'storage.limit_mb': [] } })],
    ['gates for an unobserved metric', ok(db, { limit_gates: { ...GATES, 'projects.max_projects': ['pmo.enabled'] } })],
    ['non-list gates', ok(db, { limit_gates: { ...GATES, 'users.limit': 'pmo.enabled' } })],
    ['non-string gate names', ok(db, { limit_gates: { ...GATES, 'users.limit': [1] } })],
  ])('refuses %s', (_name, observed) => {
    expect(acceptObservation(observed, db, NOW)).toBeNull()
  })
})

describe('usage collector lock connection (no database)', () => {
  const fake = (unlockFails: boolean) => {
    const released: unknown[] = []
    const client = { query: async (sql: string) => { if (sql.includes('pg_advisory_unlock') && unlockFails) throw Error('conn lost'); return { rows: [{ ok: true }] } }, release: (broken?: unknown) => { released.push(broken) } }
    return { pool: { connect: async () => client, query: async () => ({ rows: [], rowCount: 0 }) }, released }
  }
  it('releases the connection as broken when the unlock fails, healthy otherwise', async () => {
    const bad = fake(true); await collectUsage(bad.pool as never, { runner: async () => null })
    expect(bad.released).toEqual([true])
    const good = fake(false); await collectUsage(good.pool as never, { runner: async () => null })
    expect(good.released).toEqual([false])
  })
})

const suite = url ? describe : describe.skip
suite('usage collector (scratch control database)', () => {
  const pool = new Pool({ connectionString: url, max: 6 })
  beforeAll(async () => { await migrate(pool) })
  afterAll(async () => pool.end())

  async function tenant(enabled = true, opts: { state?: string; ops?: boolean } = {}) {
    const id = randomUUID(), hex = id.replaceAll('-', ''), database = `nasq_scratch_${hex}`
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Usage','saas','managed',$2,$3)", [id, `inv-${id}`, opts.ops ?? true])
    const customer = randomUUID(), subscription = randomUUID(), revision = randomUUID()
    await pool.query('INSERT INTO customers(id,name,tenant_id) VALUES($1,$2,$3)', [customer, 'Usage', id])
    await pool.query("INSERT INTO subscriptions(id,customer_id,tenant_id,state) VALUES($1,$2,$3,'active')", [subscription, customer, id])
    await pool.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,$3,$4)', [revision, subscription, JSON.stringify({ entitlement: { features: {} } }), randomUUID()])
    await pool.query('UPDATE subscriptions SET applied_revision_id=$2, revision=1, state=$3 WHERE id=$1', [subscription, revision, opts.state ?? 'active'])
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
    expect(await latest(good.id)).toEqual({ metrics: USAGE, limit_gates: GATES, source: 'odoo.observe' })
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
    await run(d => ok(d, { usage: { 'users.limit': 0 }, limit_gates: { 'users.limit': [] }, observed_at: '2026-10-07T10:04:00Z' }))
    await run(() => { throw Error('shared_effect_unverified') })
    expect(await count(t.id)).toBe(1)
    expect((await latest(t.id)).metrics).toEqual(USAGE)
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

  it('observes only live subscriptions of operational tenants', async () => {
    const live = await tenant(true, { state: 'past_due' }), suspended = await tenant(true, { state: 'suspended' }),
      cancelled = await tenant(true, { state: 'cancelled' }), off = await tenant(true, { ops: false })
    const seen: string[] = []
    await collectUsage(pool, { runner: async ({ tenant_id }) => { seen.push(tenant_id); throw Error('x') }, now: () => NOW, limit: 1000, log: () => {} })
    expect(seen).toContain(live.id)
    for (const t of [suspended, cancelled, off]) expect(seen).not.toContain(t.id)
  })

  it('orders by last attempt, oldest first, and a tenant that always fails does not stay at the head', async () => {
    await pool.query('DELETE FROM usage_collection_attempts')
    const a = await tenant(), b = await tenant(), c = await tenant(), fresh = await tenant()
    await pool.query("INSERT INTO usage_collection_attempts(tenant_id,attempted_at) VALUES($1,now()-interval '3 hours'),($2,now()-interval '2 hours'),($3,now()-interval '1 hour')", [a.id, c.id, b.id])
    const mine = new Set<string>([a.id, b.id, c.id, fresh.id])
    const seen: string[] = []
    await collectUsage(pool, { runner: async ({ tenant_id }) => { if (mine.has(tenant_id)) seen.push(tenant_id); throw Error('always fails') }, now: () => NOW, limit: 1000, log: () => {} })
    expect(seen).toEqual([fresh.id, a.id, c.id, b.id])
    // One tenant per run: the failing head moves to the back, so every tenant is reached.
    await pool.query('DELETE FROM usage_collection_attempts')
    const picks: string[] = []
    for (let i = 0; i < 4; i++) await collectUsage(pool, { runner: async ({ tenant_id }) => { picks.push(tenant_id); throw Error('always fails') }, now: () => NOW, limit: 1, log: () => {} })
    expect(new Set(picks).size).toBe(4)
  })

  it('cancels a hung observation with the runner signal', async () => {
    await pool.query('DELETE FROM usage_collection_attempts')
    await tenant()
    let signal: AbortSignal | undefined
    const result = await collectUsage(pool, { runner: ({ signal: s }) => { signal = s; return new Promise(() => {}) }, now: () => NOW, limit: 1, timeout_ms: 20, log: () => {} })
    expect(result).toMatchObject({ recorded: 0, skipped: 1 })
    expect(signal?.aborted).toBe(true)
  })

  it('stops taking targets once the time budget is spent', async () => {
    await tenant(); await tenant()
    const seen: string[] = []
    await collectUsage(pool, { runner: async ({ tenant_id }) => { seen.push(tenant_id); await new Promise(r => setTimeout(r, 200)); throw Error('slow') }, now: () => NOW, limit: 1000, budget_ms: 50, log: () => {} })
    expect(seen).toHaveLength(1)
  })

  it('lets only one collector run at a time', async () => {
    await tenant()
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const first = collectUsage(pool, { runner: async () => { await gate; throw Error('x') }, now: () => NOW, limit: 1, log: () => {} })
    await new Promise(r => setTimeout(r, 100))
    const second = await collectUsage(pool, { runner: async () => { throw Error('must not run') }, now: () => NOW, limit: 1, log: () => {} })
    expect(second.locked).toBe(true)
    release()
    expect((await first).locked).toBe(false)
  })

  it('uses its own lock: a held registry lock does not stop a run, and a run does not block the registry lock', async () => {
    await tenant()
    const registry = await pool.connect()
    const probe = await pool.connect()
    try {
      await registry.query('SELECT pg_advisory_lock($1)', [REGISTRY_ADVISORY_LOCK])
      const held = await collectUsage(pool, { runner: async () => { throw Error('x') }, now: () => NOW, limit: 1, log: () => {} })
      expect(held.locked).toBe(false)
      await registry.query('SELECT pg_advisory_unlock($1)', [REGISTRY_ADVISORY_LOCK])
      let release!: () => void
      const gate = new Promise<void>(r => { release = r })
      let started!: () => void
      const running = new Promise<void>(r => { started = r })
      const run = collectUsage(pool, { runner: async () => { started(); await gate; throw Error('x') }, now: () => NOW, limit: 1, log: () => {} })
      await running
      expect((await probe.query('SELECT pg_try_advisory_lock($1) AS ok', [REGISTRY_ADVISORY_LOCK])).rows[0].ok).toBe(true)
      await probe.query('SELECT pg_advisory_unlock($1)', [REGISTRY_ADVISORY_LOCK])
      release()
      expect((await run).locked).toBe(false)
    } finally { registry.release(); probe.release() }
  })

  it('stops before the next target on the stop signal and records no attempt for unobserved targets', async () => {
    await pool.query('DELETE FROM usage_collection_attempts')
    await tenant(); await tenant(); await tenant()
    const stop = new AbortController()
    const seen: string[] = []
    const result = await collectUsage(pool, { runner: async ({ tenant_id }) => { seen.push(tenant_id); stop.abort(); throw Error('x') }, now: () => NOW, limit: 1000, log: () => {}, signal: stop.signal })
    expect(seen).toHaveLength(1)
    expect(result.locked).toBe(false)
    expect((await pool.query('SELECT count(*)::int AS n FROM usage_collection_attempts')).rows[0].n).toBe(1)
    const before = await collectUsage(pool, { runner: async () => { throw Error('must not run') }, now: () => NOW, signal: stop.signal })
    expect(before).toEqual({ recorded: 0, skipped: 0, locked: false })
  })

  it('aborts an in-flight observation when the stop signal fires', async () => {
    await pool.query('DELETE FROM usage_collection_attempts')
    await tenant()
    const stop = new AbortController()
    let sig: AbortSignal | undefined
    const run = collectUsage(pool, { runner: ({ signal }) => { sig = signal; return new Promise(() => {}) }, now: () => NOW, limit: 1, log: () => {}, signal: stop.signal })
    await new Promise(r => setTimeout(r, 100))
    stop.abort()
    await run
    expect(sig?.aborted).toBe(true)
  })
})
