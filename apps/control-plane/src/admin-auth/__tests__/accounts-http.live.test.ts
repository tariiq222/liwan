import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { signServiceRequest } from '@nasq/commercial-contracts/server'
import { migrate, transaction } from '../../db.js'
import { createApp } from '../../http.js'
import { TEST_KEY as key, vendorSession } from '../../__tests__/helpers/vendor-session.js'
import { createSession } from '../sessions.js'
import { syncMembership } from '../accounts.js'
import { inviteAccount } from '../enrollment.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
if (url) {
  const parsed = new URL(url)
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname) || !/^nasq_control_scratch_[a-z0-9]+$/.test(parsed.pathname.slice(1))) throw new Error('CONTROL_TEST_DATABASE_URL must select a unique loopback nasq_control_scratch database')
}
const issuer = 'vendor-scratch'
const config = { installationId: issuer, key, inventoryPath: '', repositoryRoot: '/nonexistent', python: 'python3', stateDir: '/nonexistent-state' }

type Session = { accountId: number; session: string; headers: (method: string, path: string, body?: string) => Record<string, string> }

if (!url) describe.skip('account management routes (requires CONTROL_TEST_DATABASE_URL)', () => {})
else describe('account management routes', () => {
  const pool = new Pool({ connectionString: url })
  let server: ReturnType<ReturnType<typeof createApp>['listen']>
  let origin = ''
  let seq = 0
  beforeAll(async () => {
    await migrate(pool)
    server = createApp(pool, config).listen(0, '127.0.0.1')
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('missing address')
    origin = `http://127.0.0.1:${address.port}`
  })
  beforeEach(async () => { await pool.query('TRUNCATE vendor_accounts, vendor_memberships, audit_events CASCADE') })
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); await pool.end() })

  async function call(method: string, path: string, who: Session, body?: unknown) {
    const raw = body === undefined ? '' : JSON.stringify(body)
    const res = await fetch(origin + path, { method, headers: { ...who.headers(method, path, raw), 'content-type': 'application/json' }, body: raw || undefined })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : undefined }
  }
  const post = (path: string, body: unknown, who: Session) => call('POST', path, who, body)
  const get = (path: string, who: Session) => call('GET', path, who)

  /** An owner created through inviteAccount('operator') and activated, so roles and membership come from real code. */
  async function ownerSession(options: { stepUp: boolean }): Promise<Session> {
    return transaction(pool, async (client) => {
      await inviteAccount(client, issuer, 'operator', { email: `owner-${++seq}@nasq.sa`, displayName: 'Owner', roles: ['owner'], reason: 'test owner' }, new Date())
      const row = await client.query("UPDATE vendor_accounts SET status='active' WHERE email=$1 RETURNING id", [`owner-${seq}@nasq.sa`])
      const accountId = Number(row.rows[0].id)
      await syncMembership(client, issuer, accountId)
      const { session } = await createSession(client, accountId, new Date(), options.stepUp)
      return { accountId, session, headers: (method, path, body = '') => ({ ...signServiceRequest({ method, path, body, actor: accountId, issuer, key }), 'x-nasq-session': session }) }
    })
  }
  const invite = { email: 'n@nasq.sa', display_name: 'N', roles: ['support'], reason: 'new hire' }

  it('lets only owners manage accounts, with step-up', async () => {
    const finance = await vendorSession(pool, issuer, ['vendor.read', 'vendor.billing.manage'])
    expect((await post('/v1/admin/accounts', invite, finance)).status).toBe(403)
    const owner = await ownerSession({ stepUp: false })
    expect((await post('/v1/admin/accounts', invite, owner)).body.code).toBe('step_up_required')
    const fresh = await ownerSession({ stepUp: true })
    const created = await post('/v1/admin/accounts', { ...invite, email: 'N@Nasq.sa' }, fresh)
    expect(created.status).toBe(201)
    expect(created.body.invitation_token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(created.body.id).toEqual(expect.any(Number))
    const dup = await post('/v1/admin/accounts', { ...invite, reason: 'again' }, fresh)
    expect(dup.status).toBe(409); expect(dup.body.code).toBe('conflict')
    const audited = await pool.query("SELECT actor FROM audit_events WHERE action='account.roles_set' AND subject=$1", [`account:${created.body.id}`])
    expect(audited.rows[0].actor).toBe(`account:${fresh.accountId}`)
  })
  it('returns last_owner when the only owner removes their role', async () => {
    const owner = await ownerSession({ stepUp: true })
    const r = await post(`/v1/admin/accounts/${owner.accountId}/roles`, { roles: ['finance'], reason: 'oops' }, owner)
    expect(r.status).toBe(409); expect(r.body.code).toBe('last_owner')
  })
  it('disabling revokes the target sessions immediately', async () => {
    const owner = await ownerSession({ stepUp: true })
    const target = await vendorSession(pool, issuer, ['vendor.read'])
    expect((await post(`/v1/admin/accounts/${target.accountId}/disable`, { reason: 'left' }, owner)).status).toBe(204)
    expect((await get('/v1/context', target)).status).toBe(401)
  })
  it('returns the caller roles and capabilities from /me for any session', async () => {
    const owner = await ownerSession({ stepUp: false })
    const created = await post('/v1/admin/accounts', invite, await ownerSession({ stepUp: true }))
    const me = await get('/v1/admin/me', owner)
    expect(me.status).toBe(200)
    expect(me.body).toMatchObject({ id: owner.accountId, roles: ['owner'] })
    expect(me.body.capabilities).toContain('vendor.accounts.manage')
    const plain = await vendorSession(pool, issuer, ['vendor.read'])
    const plainMe = await get('/v1/admin/me', plain)
    expect(plainMe.status).toBe(200)
    expect(plainMe.body).toMatchObject({ id: plain.accountId, roles: [], capabilities: ['vendor.read'] })
    expect(created.status).toBe(201)
  })
  it('lists accounts with stale step-up', async () => {
    const owner = await ownerSession({ stepUp: false })
    await pool.query("UPDATE vendor_sessions SET step_up_at=now()-interval '1 hour'")
    const r = await get('/v1/admin/accounts', owner)
    expect(r.status).toBe(200)
    expect(r.body.total).toBe(1)
    expect(r.body.items[0]).toMatchObject({ id: owner.accountId, status: 'active', roles: ['owner'], passkeys: 0 })
    expect(r.body.items[0].last_seen_at).toEqual(expect.any(String))
    const plain = await vendorSession(pool, issuer, ['vendor.read'])
    expect((await get('/v1/admin/accounts', plain)).status).toBe(403)
  })
  it('refuses a demoted owner on its next account mutation', async () => {
    const first = await ownerSession({ stepUp: true })
    const second = await ownerSession({ stepUp: true })
    expect((await post(`/v1/admin/accounts/${second.accountId}/roles`, { roles: ['support'], reason: 'demote' }, first)).status).toBe(204)
    const r = await post('/v1/admin/accounts', invite, second)
    expect(r.status).toBe(403)
    // Stale capabilities racing the demotion are still stopped inside the transaction.
    await pool.query("UPDATE vendor_memberships SET capabilities=ARRAY['vendor.accounts.manage'] WHERE actor_uid=$1", [second.accountId])
    expect((await post(`/v1/admin/accounts/${first.accountId}/disable`, { reason: 'takeover' }, second)).status).toBe(403)
    expect((await post(`/v1/admin/accounts/${first.accountId}/roles`, { roles: ['support'], reason: 'takeover' }, second)).status).toBe(403)
    expect((await post(`/v1/admin/accounts/${first.accountId}/reset`, { reason: 'takeover' }, second)).status).toBe(403)
  })
  it('answers 422 invalid for an unknown account and bad bodies', async () => {
    const owner = await ownerSession({ stepUp: true })
    expect((await post('/v1/admin/accounts/999999/roles', { roles: ['support'], reason: 'nobody' }, owner)).body).toMatchObject({ code: 'invalid' })
    expect((await post('/v1/admin/accounts/999999/disable', { reason: 'nobody' }, owner)).status).toBe(422)
    expect((await post('/v1/admin/accounts/999999/reset', { reason: 'nobody' }, owner)).status).toBe(422)
    expect((await post('/v1/admin/accounts', { ...invite, extra: 1 }, owner)).status).toBe(422)
    expect((await post('/v1/admin/accounts', { ...invite, roles: ['god'] }, owner)).status).toBe(422)
    expect((await post('/v1/admin/accounts', { ...invite, reason: 'no' }, owner)).status).toBe(422)
  })
  it('issues a reset invitation token', async () => {
    const owner = await ownerSession({ stepUp: true })
    const target = await vendorSession(pool, issuer, ['vendor.read'])
    const r = await post(`/v1/admin/accounts/${target.accountId}/reset`, { reason: 'lost device' }, owner)
    expect(r.status).toBe(200)
    expect(r.body.invitation_token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Date.parse(r.body.expires_at)).toBeGreaterThan(Date.now())
  })
})
