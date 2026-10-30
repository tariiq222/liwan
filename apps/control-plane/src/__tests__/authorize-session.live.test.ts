import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { signServiceRequest } from '@liwan/commercial-contracts/server'
import { migrate } from '../db.js'
import { createApp } from '../http.js'
import { client as commercialClient, money, monthly, setup } from './commercial-helpers.js'
import { TEST_KEY as key, replaceRoles, vendorSession } from './helpers/vendor-session.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
if (url) {
  const parsed = new URL(url)
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname) || !/^liwan_control_scratch_[a-z0-9]+$/.test(parsed.pathname.slice(1))) throw new Error('CONTROL_TEST_DATABASE_URL must select a unique loopback liwan_control_scratch database')
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
    const s = await vendorSession(pool, issuer, ['support'])
    const noSession = s.headers('GET', '/v1/context'); delete noSession['x-liwan-session']
    expect((await call('GET', '/v1/context', noSession)).status).toBe(401)
    const forged = signServiceRequest({ method: 'GET', path: '/v1/context', actor: s.accountId + 1, issuer, key })
    expect((await call('GET', '/v1/context', { ...forged, 'x-liwan-session': s.session })).status).toBe(401)
    expect((await call('GET', '/v1/context', { ...s.headers('GET', '/v1/context'), 'x-liwan-session': 'garbage' })).status).toBe(401)
    await pool.query("UPDATE vendor_accounts SET status='disabled' WHERE id=$1", [s.accountId])
    expect((await call('GET', '/v1/context', s.headers('GET', '/v1/context'))).status).toBe(401)
  })

  it('asks for step-up before operations but not before reads', async () => {
    const s = await vendorSession(pool, issuer, ['customer_success', 'operations'], { stepUp: false })
    const body = { request_id: randomUUID(), type: 'health' }
    const path = `/v1/tenants/${randomUUID()}/operations`
    const r = await call('POST', path, s.headers('POST', path, JSON.stringify(body)), body)
    expect(r.status).toBe(403); expect(r.body.code).toBe('step_up_required')
    expect((await call('GET', '/v1/overview', s.headers('GET', '/v1/overview'))).status).toBe(200)
  })

  it('asks for step-up before publishing a catalog entry and pricing mutations', async () => {
    const s = await vendorSession(pool, issuer, ['product'], { stepUp: false })
    const body = { reason: 'Publish it now' }
    const path = `/v1/catalog/${randomUUID()}/publish`
    const r = await call('POST', path, s.headers('POST', path, JSON.stringify(body)), body)
    expect(r.status).toBe(403); expect(r.body.code).toBe('step_up_required')
    const plan = `/v1/commercial/plans/${randomUUID()}/publish`
    const p = await call('POST', plan, s.headers('POST', plan, '{}'), {})
    expect(p.status).toBe(403); expect(p.body.code).toBe('step_up_required')
  })

  async function expectStepUp(s: Awaited<ReturnType<typeof vendorSession>>, method: string, path: string, body: unknown) {
    const raw = JSON.stringify(body)
    const r = await call(method, path, s.headers(method, path, raw), body)
    expect(r.status).toBe(403); expect(r.body.code).toBe('step_up_required')
  }

  it('requires step-up for customer terms, registry publication and catalog releases', async () => {
    const s = await vendorSession(pool, issuer, ['product', 'customer_success'], { stepUp: false })
    await expectStepUp(s, 'POST', '/v1/commercial/customer-terms', {})
    await expectStepUp(s, 'POST', '/v1/registry/mutations', {})
    await expectStepUp(s, 'POST', '/v1/registry/recover', {})
    await expectStepUp(s, 'POST', '/v1/commercial/catalog/releases', {})
  })

  it('requires step-up to change bundle prices but not to rename', async () => {
    const { version } = await setup(pool)
    const api = commercialClient(pool)
    const reason = 'Test bundle prices'
    const release = (await api('POST', '/catalog/releases', { catalog_version: version, reason })).body
    const app = release.applications.find((a: any) => a.selectable && a.features.some((f: any) => f.selectable))
    const body = (over: object = {}) => ({ name: `Bundle ${randomUUID()}`, description: 'd', audience: { kind: 'public' }, catalog_release_id: release.id,
      selections: [{ app_id: app.id, feature_keys: [app.features.find((f: any) => f.selectable).key] }], domain_limits: {}, prices: [{ cadence: monthly, amount: money(0) }], ...over })
    const created = await api('POST', '/bundles', body())
    expect(created.status).toBe(201)
    const s = await vendorSession(pool, issuer, ['product'], { stepUp: false })
    const path = `/v1/commercial/bundles/${created.body.id}`
    await expectStepUp(s, 'PATCH', path, { ...body({ prices: [{ cadence: monthly, amount: money(500) }] }), edit_revision: 1, reason })
    const rename = { ...body({ name: 'Renamed only', prices: created.body.prices }), edit_revision: 1, reason }
    const r = await call('PATCH', path, s.headers('PATCH', path, JSON.stringify(rename)), rename)
    expect(r.status).toBe(200)
  })

  it('lets a billing reader without fresh step-up list invoices', async () => {
    const s = await vendorSession(pool, issuer, ['finance'], { stepUp: false })
    expect((await call('GET', '/v1/commercial/invoices', s.headers('GET', '/v1/commercial/invoices'))).status).toBe(200)
  })

  it('applies a role revocation on the next request', async () => {
    const s = await vendorSession(pool, issuer, ['support'])
    expect((await call('GET', '/v1/audit', s.headers('GET', '/v1/audit'))).status).toBe(200)
    await replaceRoles(pool, s.accountId, ['finance'])
    expect((await call('GET', '/v1/audit', s.headers('GET', '/v1/audit'))).status).toBe(403)
  })
})
