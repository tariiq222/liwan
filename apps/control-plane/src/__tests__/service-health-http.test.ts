import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { Pool } from 'pg'
import { vendorOverviewSchema } from '@liwan/commercial-contracts'
import { vendorSession } from './helpers/vendor-session.js'
import { createApp } from '../http.js'
import { migrate } from '../db.js'
import { beat, downComponents, recordAvailability } from '../service-health.js'
import { backdateBeat } from './service-health-helpers.js'
import { url } from './commercial-helpers.js'

const suite = url ? describe : describe.skip
suite('service health on the vendor overview', () => {
  const dbName = `liwan_control_scratch_healthhttp${randomUUID().slice(0, 8).replace(/-/g, '')}`
  const withDb = (name: string) => { const u = new URL(url!); u.pathname = `/${name}`; return u.toString() }
  const config = { installationId: 'health-http-test', key: 'synthetic-health-key-'.repeat(3), inventoryPath: '/unused', stateDir: '/unused', repositoryRoot: '/unused', python: 'python3' }
  let pool: Pool
  let server: Server
  let origin: string
  let created = false
  let operations: Awaited<ReturnType<typeof vendorSession>>
  let support: Awaited<ReturnType<typeof vendorSession>>
  const get = async (path: string, as = support) => { const r = await fetch(origin + path, { headers: as.headers('GET', path, '') }); return { status: r.status, body: await r.json() as any } }
  const waitForRow = async (component: string) => {
    for (let i = 0; i < 100; i++) { const r = await pool.query('SELECT detail FROM service_heartbeats WHERE component=$1', [component]); if (r.rowCount) return r.rows[0].detail; await new Promise(res => setTimeout(res, 20)) }
    throw new Error(`no ${component} row`)
  }

  beforeAll(async () => {
    const admin = new Pool({ connectionString: withDb('postgres') })
    try { await admin.query(`CREATE DATABASE ${dbName}`); created = true } finally { await admin.end() }
    pool = new Pool({ connectionString: withDb(dbName) })
    await migrate(pool)
    vi.stubEnv('LIWAN_PAYMENT_PROVIDER', '')
    server = createApp(pool, config)
    operations = await vendorSession(pool, config.installationId, ['operations'], { key: config.key })
    support = await vendorSession(pool, config.installationId, ['support'], { key: config.key })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw Error('No address')
    origin = `http://127.0.0.1:${address.port}`
  })
  afterAll(async () => {
    vi.unstubAllEnvs()
    await new Promise<void>(resolve => server?.close(() => resolve()))
    await pool?.end()
    if (!created) return
    const admin = new Pool({ connectionString: withDb('postgres') })
    try { await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`) } finally { await admin.end() }
  })

  it('records at start-up that the API could not build its payment adapter, as a code', async () => {
    expect(await waitForRow('api_payment_adapter')).toEqual({ available: false, code: 'provider_not_configured' })
  })

  it('records an adapter that was built', async () => {
    vi.stubEnv('LIWAN_PAYMENT_PROVIDER', 'simulator')
    const other = createApp(pool, config)
    try {
      for (let i = 0; i < 100 && !(await pool.query("SELECT 1 FROM service_heartbeats WHERE component='api_payment_adapter' AND detail->>'available'='true'")).rowCount; i++) await new Promise(res => setTimeout(res, 20))
      expect(await waitForRow('api_payment_adapter')).toEqual({ available: true })
    } finally { other.close() }
  })

  it('gives every caller who may read the overview the state of each component, and the reasons only to who may run operations', async () => {
    const startedAt = new Date(Date.now() - 3600_000)
    await beat(pool, 'shared_worker', { startedAt })
    await recordAvailability(pool, 'mail_adapter', { startedAt, error: Object.assign(new Error('smtp://user:pw@mail.internal'), { code: 'mail_not_configured' }) })
    const plain = await get('/v1/overview', support)
    const full = await get('/v1/overview', operations)
    expect(plain.status).toBe(200)
    const parsed = vendorOverviewSchema.parse(plain.body)
    expect(parsed.health!.map(i => [i.component, i.state])).toEqual([['shared_worker', 'ok'], ['commercial_scheduler', 'never_seen'], ['payment_adapter', 'never_seen'], ['mail_adapter', 'unavailable'], ['alert_channel', 'never_seen'], ['api_payment_adapter', 'ok']])
    expect(parsed.health!.every(i => i.detail === null)).toBe(true)
    expect(JSON.stringify(plain.body)).not.toContain('mail_not_configured')
    expect(vendorOverviewSchema.parse(full.body).health!.find(i => i.component === 'mail_adapter')!.detail).toEqual({ available: false, code: 'mail_not_configured' })
    expect(JSON.stringify(full.body)).not.toContain('pw@mail.internal')
  })

  it('carries the same health on the combined overview of both queues', async () => {
    const all = await get('/v1/overview?source=all', operations)
    expect(all.status).toBe(200)
    expect(vendorOverviewSchema.parse(all.body).health).toHaveLength(6)
  })

  describe('the components the API expects', () => {
    const expected = ['shared_worker', 'commercial_scheduler']
    const rows = async () => (await pool.query("SELECT component, detail FROM service_heartbeats WHERE component = ANY($1) ORDER BY component", [expected])).rows
    const startApi = async (mode: string | undefined) => {
      vi.stubEnv('LIWAN_TENANCY_MODE', mode ?? '')
      const other = createApp(pool, config)
      await new Promise(res => setTimeout(res, 300))
      other.close()
      vi.stubEnv('LIWAN_TENANCY_MODE', '')
      return other
    }
    const clear = () => pool.query("DELETE FROM service_heartbeats WHERE component = ANY($1)", [expected])

    it('registers them in shared mode, so a worker that never starts turns stale and is alerted on', async () => {
      await clear()
      await startApi('shared')
      expect((await rows()).map(r => r.component)).toEqual(['commercial_scheduler', 'shared_worker'])
      expect((await downComponents(pool)).map(d => d.component)).not.toContain('shared_worker')
      await backdateBeat(pool, 'shared_worker', 3 * 60_000)
      await backdateBeat(pool, 'commercial_scheduler', 3 * 60_000)
      expect((await downComponents(pool)).map(d => d.component)).toEqual(['shared_worker'])
      await backdateBeat(pool, 'commercial_scheduler', 3 * 60_000)
      expect((await downComponents(pool)).map(d => d.component)).toEqual(['shared_worker', 'commercial_scheduler'])
    })

    it('keeps the beat of a worker that is already running', async () => {
      await clear()
      await beat(pool, 'shared_worker', { startedAt: new Date(Date.now() - 3600_000) })
      const before = await rows()
      await startApi('shared')
      expect((await rows()).find(r => r.component === 'shared_worker')).toEqual(before[0])
      expect((await pool.query("SELECT count(*)::int AS n FROM service_heartbeats WHERE component='shared_worker' AND started_at < now() - interval '30 minutes'")).rows[0].n).toBe(1)
    })

    it('registers nothing in dedicated mode, where the worker is not part of the product and the components stay never seen', async () => {
      await clear()
      await startApi(undefined)
      await startApi('dedicated')
      expect(await rows()).toEqual([])
    })
  })

  it('answers the overview with health null when the table cannot be read', async () => {
    await pool.query('ALTER TABLE service_heartbeats RENAME TO service_heartbeats_away')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      for (const path of ['/v1/overview', '/v1/overview?source=all']) {
        const response = await get(path, operations)
        expect(response.status, path).toBe(200)
        expect(vendorOverviewSchema.parse(response.body)).toMatchObject({ health: null, tenants: 0 })
      }
    } finally { spy.mockRestore(); await pool.query('ALTER TABLE service_heartbeats_away RENAME TO service_heartbeats') }
  })
})
