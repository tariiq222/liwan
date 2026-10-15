import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { signServiceRequest } from '@nasq/commercial-contracts/server'
import { migrate } from '../db.js'
import { createApp } from '../http.js'
import { TEST_KEY as key, vendorSession } from './helpers/vendor-session.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
if (url) {
  const parsed = new URL(url)
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname) || !/^nasq_control_scratch_[a-z0-9]+$/.test(parsed.pathname.slice(1))) throw new Error('CONTROL_TEST_DATABASE_URL must select a unique loopback nasq_control_scratch database')
}
const issuer = 'vendor-scratch'
const config = { installationId: issuer, key, inventoryPath: '', repositoryRoot: '/nonexistent', python: 'python3', stateDir: '/nonexistent-state' }

if (!url) describe.skip('session authorization (requires CONTROL_TEST_DATABASE_URL)', () => {})
else describe('session authorization', () => {
  const pool = new Pool({ connectionString: url })
  let server: ReturnType<ReturnType<typeof createApp>['listen']>
  let origin = ''
  beforeAll(async () => {
    await migrate(pool)
    server = createApp(pool, config).listen(0, '127.0.0.1')
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('missing address')
    origin = `http://127.0.0.1:${address.port}`
  })
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); await pool.end() })

  async function call(method: string, path: string, headers: Record<string, string>, body?: unknown) {
    const raw = body === undefined ? undefined : JSON.stringify(body)
    const res = await fetch(origin + path, { method, headers: { ...headers, 'content-type': 'application/json' }, body: raw })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : undefined }
  }

  it('rejects requests without a session, with a forged actor, or for a disabled account', async () => {
    const s = await vendorSession(pool, issuer, ['vendor.read'])
    const noSession = s.headers('GET', '/v1/context'); delete noSession['x-nasq-session']
    expect((await call('GET', '/v1/context', noSession)).status).toBe(401)
    const forged = signServiceRequest({ method: 'GET', path: '/v1/context', actor: s.accountId + 1, issuer, key })
    expect((await call('GET', '/v1/context', { ...forged, 'x-nasq-session': s.session })).status).toBe(401)
    expect((await call('GET', '/v1/context', { ...s.headers('GET', '/v1/context'), 'x-nasq-session': 'garbage' })).status).toBe(401)
    await pool.query("UPDATE vendor_accounts SET status='disabled' WHERE id=$1", [s.accountId])
    expect((await call('GET', '/v1/context', s.headers('GET', '/v1/context'))).status).toBe(401)
  })

  it('asks for step-up before operations but not before reads', async () => {
    const s = await vendorSession(pool, issuer, ['vendor.read', 'vendor.tenants.manage', 'vendor.operations.run'], { stepUp: false })
    const body = { request_id: randomUUID(), type: 'health' }
    const path = `/v1/tenants/${randomUUID()}/operations`
    const r = await call('POST', path, s.headers('POST', path, JSON.stringify(body)), body)
    expect(r.status).toBe(403); expect(r.body.code).toBe('step_up_required')
    expect((await call('GET', '/v1/overview', s.headers('GET', '/v1/overview'))).status).toBe(200)
  })

  it('asks for step-up before publishing a catalog entry and pricing mutations', async () => {
    const s = await vendorSession(pool, issuer, ['vendor.read', 'vendor.catalog.manage', 'vendor.pricing.manage'], { stepUp: false })
    const body = { reason: 'Publish it now' }
    const path = `/v1/catalog/${randomUUID()}/publish`
    const r = await call('POST', path, s.headers('POST', path, JSON.stringify(body)), body)
    expect(r.status).toBe(403); expect(r.body.code).toBe('step_up_required')
    const plan = `/v1/commercial/plans/${randomUUID()}/publish`
    const p = await call('POST', plan, s.headers('POST', plan, '{}'), {})
    expect(p.status).toBe(403); expect(p.body.code).toBe('step_up_required')
  })

  it('applies a role revocation on the next request', async () => {
    const s = await vendorSession(pool, issuer, ['vendor.read', 'vendor.audit.read'])
    expect((await call('GET', '/v1/audit', s.headers('GET', '/v1/audit'))).status).toBe(200)
    await pool.query("UPDATE vendor_memberships SET capabilities=ARRAY['vendor.read'] WHERE actor_uid=$1", [s.accountId])
    expect((await call('GET', '/v1/audit', s.headers('GET', '/v1/audit'))).status).toBe(403)
  })
})
