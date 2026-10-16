import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { operationFeedSchema, sharedOperationFeedSchema } from '@nasq/commercial-contracts'
import { vendorSession } from './helpers/vendor-session.js'
import { createApp } from '../http.js'
import { migrate } from '../db.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
if (url) {
  const parsed = new URL(url)
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname) || !/^nasq_control_scratch_[a-z0-9_]+$/.test(parsed.pathname.slice(1))) throw Error('Requires isolated loopback scratch database')
}
describe.skipIf(!url)('opt-in operation feed on PostgreSQL', () => {
  const pool = new Pool({ connectionString: url })
  const config = { installationId: 'operation-feed-test', key: 'synthetic-feed-key-'.repeat(4), inventoryPath: '/unused', stateDir: '/unused', repositoryRoot: '/unused', python: 'python3' }
  const tenant = randomUUID(), otherTenant = randomUUID()
  const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const server = createApp(pool, config)
  let origin: string
  const sessions = {} as Record<number, Awaited<ReturnType<typeof vendorSession>>>
  beforeAll(async () => {
    await migrate(pool)
    await pool.query('TRUNCATE tenants CASCADE')
    await pool.query('TRUNCATE vendor_accounts CASCADE')
    sessions[7] = await vendorSession(pool, config.installationId, ['operations'], { key: config.key })
    sessions[8] = await vendorSession(pool, config.installationId, [], { key: config.key })
    for (const [tid, slug] of [[tenant, 'feed_a'], [otherTenant, 'feed_b']]) {
      await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,status,operations_enabled) VALUES($1,$2,'saas','managed',$2,'needs_intervention',true)", [tid, slug])
      await pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$2,$2,$2,false,1)', [tid, slug])
    }
    for (const n of [...Array.from({ length: 26 }, (_, i) => i + 1).filter(n => n !== 2), 2]) {
      const state = n === 1 ? 'queued' : n === 2 ? 'running' : n === 3 ? 'needs_intervention' : 'verified'
      const attempt = randomUUID()
      await pool.query(`INSERT INTO shared_jobs(id,control_tenant_id,business_key,payload,payload_digest,issuer,actor_uid,reason,state,attempt_id,fence,lease_until,created_at)
        VALUES($1::uuid,$2,$1::text,$3,$4,$5,7,'executor failed: postgres://secret@host /private/filestore','running',$6,1,now()+interval '1 hour','2026-10-01T00:00:00Z')`,
      [id(n), n === 26 ? otherTenant : tenant, { operation: n === 3 ? 'backup' : 'provision', requestId: id(n), secret: 'sensitive', binding: { database: 'private_db' } }, 'a'.repeat(64), config.installationId, attempt])
      if (n === 3 || n === 4) await pool.query("INSERT INTO shared_job_events(job_id,attempt_id,fence,sequence,stage,evidence,created_at) VALUES($1,$2,1,1,$3,$4,'2026-10-01T00:05:00Z')", [id(n), attempt, n === 3 ? 'started' : 'verified', { secret: 'sensitive', path: '/private/filestore' }])
      await pool.query('UPDATE shared_jobs SET state=$2,journal=$3,receipt=$4 WHERE id=$1', [id(n), state, { stage: 'started', secret: 'sensitive' }, { secret: 'sensitive' }])
    }
    for (const [n, state] of [[3, 'failed'], [30, 'queued']] as const) await pool.query(`INSERT INTO operations(id,tenant_id,actor_uid,issuer,type,status,request_id,reason,payload,payload_digest,created_at)
      VALUES($1,$2,7,$3,'health',$4,$1,'Legacy reason','{}','digest','2026-10-01T00:00:00Z')`, [id(n), tenant, config.installationId, state])
    await pool.query(`INSERT INTO shared_onboardings(request_id,control_tenant_id,issuer,actor_uid,request_digest,admin_name,admin_login,host,tenant_slug,database_name,job_id,stage)
      VALUES($1,$2,$3,7,$4,'Admin','admin@example.invalid','feed.invalid','feed','private_db',$5,'needs_intervention')`, [randomUUID(), tenant, config.installationId, 'b'.repeat(64), id(4)])
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw Error('No address')
    origin = `http://127.0.0.1:${address.port}`
  })
  afterAll(async () => { await pool.query('TRUNCATE shared_job_events, shared_jobs, shared_registry_audit, shared_registry_hosts, shared_registry_bindings CASCADE'); await new Promise<void>(resolve => server.close(() => resolve())); await pool.end() })
  async function call(path: string, actor = 7, method = 'GET', body = '') {
    return fetch(origin + path, { method, headers: sessions[actor]!.headers(method, path, body), body: body || undefined })
  }
  async function get(path: string) { const response = await call(path); expect(response.status).toBe(200); return response.json() }
  it('counts both queues once without treating onboarding readiness as queue failure', async () => {
    expect(await get('/v1/overview')).toMatchObject({ pending_operations: 1, failed_operations: 1 })
    expect(await get('/v1/overview?source=all')).toMatchObject({ pending_operations: 3, failed_operations: 2 })
  })
  it('paginates a stable mixed union and retains totals beyond the final page', async () => {
    const first = await get('/v1/operations?source=all')
    const second = await get('/v1/operations?source=all&page=2')
    expect(first.items.every((op: unknown) => operationFeedSchema.safeParse(op).success)).toBe(true)
    expect(first.total).toBe(28); expect(first.items).toHaveLength(25); expect(second.items).toHaveLength(3)
    expect(first.items.slice(0, 3).map((op: any) => [op.source, op.id])).toEqual([['legacy', id(30)], ['legacy', id(3)], ['shared', id(26)]])
    expect(new Set([...first.items, ...second.items].map((op: any) => `${op.source}:${op.id}`)).size).toBe(28)
    expect(await get('/v1/operations?source=all&page=3')).toEqual({ items: [], total: 28 })
    expect(await get(`/v1/operations?source=all&tenant_id=${otherTenant}`)).toMatchObject({ total: 1, items: [{ id: id(26), source: 'shared' }] })
    expect(await get(`/v1/operations?source=all&tenant_id=${randomUUID()}`)).toEqual({ items: [], total: 0 })
  })
  it('keeps the legacy default and disambiguates the same UUID by source', async () => {
    const legacy = await get(`/v1/operations/${id(3)}`)
    expect(legacy).toMatchObject({ type: 'health', status: 'failed', reason: 'Legacy reason' }); expect(legacy).not.toHaveProperty('source')
    expect((await get('/v1/operations')).total).toBe(2)
    expect(await get(`/v1/operations/${id(3)}?source=shared`)).toMatchObject({ source: 'shared', type: 'backup', status: 'needs_intervention', stage: 'needs_intervention' })
    expect((await call(`/v1/operations/${id(30)}?source=shared`)).status).toBe(404)
  })
  it('whitelists shared output, overrides stale stage and uses real or null timestamps', async () => {
    const detail = await get(`/v1/operations/${id(3)}?source=shared`)
    expect(sharedOperationFeedSchema.safeParse(detail).success).toBe(true)
    expect(Object.keys(detail).sort()).toEqual(['created_at','events','id','last_event_at','reason','request_id','result','source','stage','status','tenant_id','type','updated_at'].sort())
    expect(detail).toMatchObject({ result: null, updated_at: null, last_event_at: '2026-10-01T00:05:00.000Z', reason: 'shared_execution_needs_attention', events: [{ stage: 'started', status: 'running', at: '2026-10-01T00:05:00.000Z' }] })
    expect(JSON.stringify(detail)).not.toMatch(/secret|private|evidence|journal|receipt|postgres/)
    const queued = await get(`/v1/operations/${id(1)}?source=shared`)
    expect(queued).toMatchObject({ status: 'queued', stage: 'queued', last_event_at: null, updated_at: null, events: [] })
    const verified = await get(`/v1/operations/${id(4)}?source=shared`)
    expect(verified).toMatchObject({ status: 'verified', stage: 'verified', reason: 'shared_execution_verified' })
    const list = await get('/v1/operations?source=all')
    expect(JSON.stringify(list.items.filter((op: any) => op.source === 'shared'))).not.toMatch(/secret|private|evidence|journal|receipt|postgres/)
  })
  it('requires vendor.read for all new read paths and rejects ambiguous source values', async () => {
    for (const path of ['/v1/overview?source=all', '/v1/operations?source=all', `/v1/operations/${id(3)}?source=shared`]) expect((await call(path, 8)).status).toBe(403)
    for (const path of ['/v1/overview?source=shared', '/v1/operations?source=bogus', '/v1/operations?source=all&source=legacy', '/v1/operations?source=all&tenant_id=bad-id', `/v1/operations/${id(3)}?source=all`]) expect((await call(path)).status).toBe(422)
  })
  it('does not route explicit shared retry to a colliding legacy operation', async () => {
    const response = await call(`/v1/operations/${id(3)}/retry?source=shared`, 7, 'POST', JSON.stringify({ request_id: randomUUID(), reason: 'Do not retry shared' }))
    expect(response.status).toBe(422); expect(await response.json()).toMatchObject({ code: 'retry_forbidden' })
    expect((await pool.query('SELECT count(*)::int AS count FROM operations')).rows[0].count).toBe(2)
  })
})
