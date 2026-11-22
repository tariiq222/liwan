import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { SERVICE_COMPONENTS, serviceHealthSchema } from '@liwan/commercial-contracts'
import { migrate } from '../db.js'
import { beat, downComponents, readHealth, recordAvailability } from '../service-health.js'
import { url } from './commercial-helpers.js'

const T0 = new Date('2026-11-22T10:00:00Z')
const after = (ms: number) => new Date(T0.getTime() + ms)
const SECOND = 1000, MINUTE = 60 * SECOND, HOUR = 60 * MINUTE

const suite = url ? describe : describe.skip
suite('service health on PostgreSQL', () => {
  const dbName = `liwan_control_scratch_health${randomUUID().slice(0, 8).replace(/-/g, '')}`
  const withDb = (name: string) => { const u = new URL(url!); u.pathname = `/${name}`; return u.toString() }
  let pool: Pool
  let created = false
  const state = async (component: string, now: Date, includeDetail = true) => (await readHealth(pool, { now, includeDetail })).find(i => i.component === component)!

  beforeAll(async () => {
    const admin = new Pool({ connectionString: withDb('postgres') })
    try { await admin.query(`CREATE DATABASE ${dbName}`); created = true } finally { await admin.end() }
    pool = new Pool({ connectionString: withDb(dbName) })
    await migrate(pool)
  })
  afterAll(async () => {
    await pool?.end()
    if (!created) return
    const admin = new Pool({ connectionString: withDb('postgres') })
    try { await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`) } finally { await admin.end() }
  })
  beforeEach(async () => { await pool.query('DELETE FROM service_heartbeats'); await pool.query('TRUNCATE shared_job_events, shared_jobs, shared_registry_audit, shared_registry_hosts, shared_registry_bindings CASCADE') })

  async function runningJob() {
    const tenant = randomUUID()
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,$2,'saas','dedicated_managed',$2,false)", [tenant, `health-${tenant}`])
    await pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$2,$2,$2,false,1)', [tenant, tenant.slice(0, 8)])
    await pool.query("INSERT INTO shared_jobs(id,control_tenant_id,business_key,payload,payload_digest,issuer,actor_uid,reason,state) VALUES($1,$2,'k','{}',$3,'health-test',7,'Fixture','queued')", [randomUUID(), tenant, 'a'.repeat(64)])
    await pool.query("UPDATE shared_jobs SET state='running', attempt_id=$1, fence=1, lease_until=now()+interval '1 hour' WHERE control_tenant_id=$2", [randomUUID(), tenant])
  }

  it('reports every component as never seen on a fresh install, in a fixed order', async () => {
    const items = await readHealth(pool, { now: T0, includeDetail: true })
    expect(items.map(i => i.component)).toEqual([...SERVICE_COMPONENTS])
    expect(items.every(i => i.state === 'never_seen' && i.since === null && i.last_beat_at === null && i.detail === null)).toBe(true)
    expect(serviceHealthSchema.parse(items)).toHaveLength(SERVICE_COMPONENTS.length)
    expect(await downComponents(pool, T0)).toEqual([])
  })

  it('calls the worker stale only after two minutes without a beat', async () => {
    await beat(pool, 'shared_worker', { startedAt: after(-HOUR), now: T0 })
    expect((await state('shared_worker', after(2 * MINUTE))).state).toBe('ok')
    expect((await state('shared_worker', after(2 * MINUTE + 1))).state).toBe('stale')
    const seen = await state('shared_worker', after(SECOND))
    expect(seen).toMatchObject({ state: 'ok', since: '2026-11-22T09:00:00Z', last_beat_at: '2026-11-22T10:00:00Z' })
  })

  it('updates the one row of a component in place', async () => {
    await beat(pool, 'shared_worker', { startedAt: T0, now: T0 })
    await beat(pool, 'shared_worker', { startedAt: T0, now: after(30 * SECOND) })
    expect((await pool.query('SELECT count(*)::int AS n FROM service_heartbeats')).rows[0].n).toBe(1)
    expect((await state('shared_worker', after(31 * SECOND))).last_beat_at).toBe('2026-11-22T10:00:30Z')
  })

  it('calls the scheduler stale after five minutes, and after two hours while a shared job runs', async () => {
    await beat(pool, 'commercial_scheduler', { startedAt: T0, now: T0, detail: { ticks: 3 } })
    expect((await state('commercial_scheduler', after(5 * MINUTE))).state).toBe('ok')
    expect((await state('commercial_scheduler', after(5 * MINUTE + 1))).state).toBe('stale')
    await runningJob()
    expect((await state('commercial_scheduler', after(HOUR))).state).toBe('ok')
    expect((await state('commercial_scheduler', after(2 * HOUR))).state).toBe('ok')
    expect((await state('commercial_scheduler', after(2 * HOUR + 1))).state).toBe('stale')
    // The grace is the scheduler's own: a worker that stops beating is still stale after two minutes.
    await beat(pool, 'shared_worker', { startedAt: T0, now: T0 })
    expect((await state('shared_worker', after(2 * MINUTE + 1))).state).toBe('stale')
  })

  it('records an adapter as available or unavailable and never calls it stale', async () => {
    await recordAvailability(pool, 'payment_adapter', { startedAt: T0, now: T0, error: Object.assign(new Error('missing MOYASAR_SECRET_KEY'), { code: 'provider_not_configured' }) })
    await recordAvailability(pool, 'mail_adapter', { startedAt: T0, now: T0 })
    expect(await state('payment_adapter', after(30 * 24 * HOUR))).toMatchObject({ state: 'unavailable', detail: { available: false, code: 'provider_not_configured' } })
    expect(await state('mail_adapter', after(30 * 24 * HOUR))).toMatchObject({ state: 'ok', detail: { available: true } })
  })

  it('stores a code, never the message, of an adapter error that carries a secret', async () => {
    const error = new Error('connect to https://admin:hunter2@pay.example.test/v1?key=sk_live_123 failed\nforged line')
    await recordAvailability(pool, 'payment_adapter', { startedAt: T0, now: T0, error })
    await recordAvailability(pool, 'alert_channel', { startedAt: T0, now: T0, error: Object.assign(new Error('https://u:hunter2@x.test'), { code: 'telegram_not_configured\nforged' }) })
    const stored = JSON.stringify((await pool.query('SELECT detail FROM service_heartbeats ORDER BY component')).rows)
    for (const leak of ['hunter2', 'sk_live_123', 'pay.example.test', 'forged line', '\\n']) expect(stored).not.toContain(leak)
    expect((await state('payment_adapter', T0)).detail).toEqual({ available: false, code: 'Error' })
    expect((await state('alert_channel', T0)).detail).toEqual({ available: false, code: 'telegram_not_configured forged' })
  })

  it('hides detail from a caller who may not see it', async () => {
    await beat(pool, 'commercial_scheduler', { startedAt: T0, now: T0, detail: { ticks: 3, failed_jobs: ['vendor-alerts'] } })
    expect((await state('commercial_scheduler', T0, true)).detail).toEqual({ ticks: 3, failed_jobs: ['vendor-alerts'] })
    expect((await state('commercial_scheduler', T0, false)).detail).toBeNull()
  })

  it('lists a stale worker and an unavailable adapter as down, but not the adapters of a dead worker', async () => {
    await beat(pool, 'shared_worker', { startedAt: T0, now: T0 })
    await recordAvailability(pool, 'payment_adapter', { startedAt: T0, now: T0, error: new Error('x') })
    await recordAvailability(pool, 'api_payment_adapter', { startedAt: T0, now: T0, error: new Error('x') })
    expect((await downComponents(pool, after(MINUTE))).map(d => d.component)).toEqual(['payment_adapter', 'api_payment_adapter'])
    // The worker is now stale: its own adapters' last record is unknown, the API's is not.
    const down = await downComponents(pool, after(3 * MINUTE))
    expect(down.map(d => [d.component, d.state])).toEqual([['shared_worker', 'stale'], ['api_payment_adapter', 'unavailable']])
    expect((await state('payment_adapter', after(3 * MINUTE))).state).toBe('unavailable')
  })

  it('never throws when a write fails: it logs and returns', async () => {
    const logged: string[] = []
    const broken = { query: async () => { throw new Error('connection to db.internal:5432 refused') } } as unknown as Pool
    await expect(beat(broken, 'shared_worker', { startedAt: T0, now: T0, log: (m, e) => logged.push(`${m} ${e instanceof Error ? e.message : ''}`) })).resolves.toBeUndefined()
    await expect(recordAvailability(broken, 'mail_adapter', { startedAt: T0, now: T0, log: (m) => logged.push(m) })).resolves.toBeUndefined()
    expect(logged).toHaveLength(2)
  })

  it('throws when the table cannot be read, so the caller decides what an unreadable table means', async () => {
    const broken = { query: async () => { throw new Error('relation does not exist') } } as unknown as Pool
    await expect(readHealth(broken, { now: T0, includeDetail: false })).rejects.toThrow('relation')
  })
})
