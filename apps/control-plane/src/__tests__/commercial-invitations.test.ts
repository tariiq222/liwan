import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { url, setup } from './commercial-helpers.js'
import { acceptInvitation, issueHandoffInvitation, issueInvitation, sendInvitationOutbox, InvitationError, INVITATION_MAX_ATTEMPTS, HANDOFF_INVITATION_TTL_SECONDS } from '../commercial/invitations.js'
import { applyReceipt } from '../commercial/fulfillment.js'
import { isAllowedInvitationOrigin } from '../commercial/invitation-tokens.js'
import { invitationHttp, ACCEPT_PATH } from '../commercial/invitation-http.js'
import { SmtpMailAdapter, type MailAdapter, type MailMessage } from '../commercial/mail-adapter.js'
import { createApp } from '../http.js'
import { signServiceRequest } from '@liwan/commercial-contracts/server'
import { fixedReturnOrigin, tenantReturnOrigin } from '../commercial/return-origin.js'

/** The accept route builds its setter from the internal effect client in shared mode; a stub records the calls the
 *  HTTP path makes while the real odooSetPassword still validates and maps its answer. */
const effectSet = vi.hoisted(() => [] as Array<{ login: string; password: string }>)
vi.mock('../commercial/invitation-effect-client.js', () => ({
  internalEffectPasswordAdapter: () => ({ setAdminPassword: async (x: { admin_login: string; password: string }) => {
    effectSet.push({ login: x.admin_login, password: x.password })
    return { login: x.admin_login, user_id: 2, changed_at: '2026-10-02T12:00:00Z' }
  } }),
}))

const d = url ? describe : describe.skip
d('admin invitations', () => {
  let pool: Pool, customer = '', tenant = ''
  const sent: MailMessage[] = []
  const mail: MailAdapter = { async send(m) { sent.push(m); return { accepted: true, provider_message_id: 'p-' + m.message_id } } }
  const set: Array<{ login: string; password: string }> = []
  const setPassword = async (x: any) => { set.push({ login: x.admin_login, password: x.password }) }
  const tokenOf = () => /token=([^\s"&]+)/.exec(sent[sent.length - 1].text)![1]
  const PW = 'a-long-password-1'
  beforeAll(async () => {
    pool = new Pool({ connectionString: url })
    await setup(pool)
  })
  afterAll(async () => { await pool.end() })
  beforeEach(async () => {
    sent.length = 0; set.length = 0; effectSet.length = 0
    await pool.query('TRUNCATE admin_invitations, commercial_outbox')
    tenant = randomUUID(); customer = randomUUID()
    await pool.query(`INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'T','saas','dedicated_managed',$2,true)`, [tenant, 'inv-' + tenant])
    await pool.query(`INSERT INTO customers(id,name,tenant_id) VALUES($1,'شركة',$2)`, [customer, tenant])
  })
  const issue = (ttl = 3600) => issueInvitation(pool, { customer_id: customer, tenant_id: tenant, admin_login: 'admin@x.test', ttl_seconds: ttl })

  it('issues, sends via outbox, scrubs token, stores only hash', async () => {
    const inv = await issue()
    expect(await sendInvitationOutbox(pool, { mail, returnOrigin: fixedReturnOrigin('https://app.liwan.test') })).toEqual({ sent: 1, failed: 0 })
    expect(sent[0].to).toBe('admin@x.test')
    const tok = tokenOf()
    const row = (await pool.query('SELECT * FROM admin_invitations WHERE id=$1', [inv.id])).rows[0]
    expect(row.delivery_status).toBe('sent')
    expect(JSON.stringify(row)).not.toContain(tok)
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify((await pool.query('SELECT payload FROM commercial_outbox')).rows)).not.toContain(tok)
  })
  it('never accepts a wildcard origin for an invitation link', () => {
    expect(isAllowedInvitationOrigin('https://*.liwanos.com')).toBe(false)
    expect(isAllowedInvitationOrigin('https://app.liwanos.com')).toBe(true)
  })
  it('links each tenant admin to the tenant\'s own host in shared mode', async () => {
    const bind = async (t: string, host: string) => pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,true,1)', [t, 't' + t.replaceAll('-', '').slice(0, 12), host, 'db_' + t.replaceAll('-', '').slice(0, 12)])
    const key = randomUUID().slice(0, 8)
    await bind(tenant, `acme-${key}.saas.example`)
    await issue()
    const other = { tenant: randomUUID(), customer: randomUUID() }
    await pool.query(`INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'T2','saas','dedicated_managed',$2,true)`, [other.tenant, 'inv-' + other.tenant])
    await pool.query(`INSERT INTO customers(id,name,tenant_id) VALUES($1,'Two',$2)`, [other.customer, other.tenant])
    await bind(other.tenant, `globex-${key}.saas.example`)
    await issueInvitation(pool, { customer_id: other.customer, tenant_id: other.tenant, admin_login: 'two@x.test', ttl_seconds: 3600 })
    expect(await sendInvitationOutbox(pool, { mail, returnOrigin: tenantReturnOrigin(pool, ['https://*.saas.example']) })).toEqual({ sent: 2, failed: 0 })
    const links = sent.map(m => /https:\/\/[^\s"]+\/invite\/accept/.exec(m.text)![0]).sort()
    expect(links).toEqual([`https://acme-${key}.saas.example/invite/accept`, `https://globex-${key}.saas.example/invite/accept`])
    expect(sent.every(m => !m.text.includes('*'))).toBe(true)
  })
  const origin = fixedReturnOrigin('https://app.liwan.test')
  const makeDue = () => pool.query("UPDATE commercial_outbox SET next_attempt_at=now() WHERE status='pending'")
  const outbox = async () => (await pool.query("SELECT status, attempts, payload FROM commercial_outbox WHERE kind='invitation.send'")).rows[0]
  it('retries a send that failed once and delivers it on a later pass without a vendor step', async () => {
    const inv = await issue()
    let calls = 0
    const flaky: MailAdapter = { async send(m) { if (++calls === 1) throw new Error('smtp down'); sent.push(m); return { accepted: true, provider_message_id: 'p-' + m.message_id } } }
    const logged: string[] = []
    expect(await sendInvitationOutbox(pool, { mail: flaky, returnOrigin: origin, log: m => logged.push(m) })).toEqual({ sent: 0, failed: 0 })
    expect(logged).toEqual([`invitation ${inv.id} send failed (attempt 1 of 5)`])
    const pending = await outbox()
    expect(pending.status).toBe('pending'); expect(pending.attempts).toBe(1)
    expect(typeof pending.payload.token).toBe('string')
    expect((await pool.query('SELECT delivery_status FROM admin_invitations')).rows[0].delivery_status).not.toBe('failed')
    expect(await sendInvitationOutbox(pool, { mail: flaky, returnOrigin: origin })).toEqual({ sent: 0, failed: 0 }) // backing off, not due yet
    await makeDue()
    expect(await sendInvitationOutbox(pool, { mail: flaky, returnOrigin: origin })).toEqual({ sent: 1, failed: 0 })
    expect((await pool.query('SELECT delivery_status FROM admin_invitations')).rows[0].delivery_status).toBe('sent')
    const done = await outbox()
    expect(done.status).toBe('done'); expect(done.payload.token).toBeUndefined()
  })
  it('fails an invitation for good only on the fifth failed attempt and scrubs the token then', async () => {
    await issue()
    const broken: MailAdapter = { async send() { throw new Error('smtp down') } }
    for (let n = 1; n < INVITATION_MAX_ATTEMPTS; n++) {
      await makeDue()
      expect(await sendInvitationOutbox(pool, { mail: broken, returnOrigin: origin })).toEqual({ sent: 0, failed: 0 })
      const row = await outbox()
      expect(row.status).toBe('pending'); expect(row.attempts).toBe(n); expect(typeof row.payload.token).toBe('string')
    }
    await makeDue()
    expect(await sendInvitationOutbox(pool, { mail: broken, returnOrigin: origin })).toEqual({ sent: 0, failed: 1 })
    const row = await outbox()
    expect(row.status).toBe('failed'); expect(row.payload.token).toBeUndefined(); expect(row.payload.error).toBe('smtp down')
    expect((await pool.query('SELECT delivery_status FROM admin_invitations')).rows[0].delivery_status).toBe('failed')
    await makeDue()
    expect(await sendInvitationOutbox(pool, { mail: broken, returnOrigin: origin })).toEqual({ sent: 0, failed: 0 })
  })
  /** A pool whose delivery-recording statement fails the first `times` calls, as a dropped connection would. */
  const failingRecord = (times: number) => {
    let left = times
    return { query: (sql: string, ...rest: unknown[]) => sql.includes('WITH delivered') && left-- > 0 ? Promise.reject(new Error('connection reset')) : (pool.query as (...a: unknown[]) => Promise<unknown>)(sql, ...rest) } as unknown as Pool
  }
  it('records a delivery again without mailing again when only the recording failed', async () => {
    const inv = await issue()
    expect(await sendInvitationOutbox(failingRecord(2), { mail, returnOrigin: origin })).toEqual({ sent: 1, failed: 0 })
    expect(sent).toHaveLength(1)
    expect((await pool.query('SELECT delivery_status FROM admin_invitations WHERE id=$1', [inv.id])).rows[0].delivery_status).toBe('sent')
    const done = await outbox()
    expect(done.status).toBe('done'); expect(done.payload.token).toBeUndefined()
  })
  it('never marks a delivered mail failed when its recording keeps failing', async () => {
    const inv = await issue()
    const logged: string[] = []
    expect(await sendInvitationOutbox(failingRecord(99), { mail, returnOrigin: origin, log: m => logged.push(m) })).toEqual({ sent: 0, failed: 0 })
    expect(sent).toHaveLength(1)
    expect(logged).toEqual([`invitation ${inv.id} was sent but its delivery could not be recorded`])
    expect((await pool.query('SELECT delivery_status FROM admin_invitations WHERE id=$1', [inv.id])).rows[0].delivery_status).not.toBe('failed')
    expect((await outbox()).attempts).toBe(0)
  })
  it('scrubs the token from the outbox row of an invitation that was superseded before it was sent', async () => {
    const inv = await issue()
    await pool.query('UPDATE admin_invitations SET revoked_at=now() WHERE id=$1', [inv.id])
    expect(await sendInvitationOutbox(pool, { mail, returnOrigin: origin })).toEqual({ sent: 0, failed: 0 })
    expect(sent).toHaveLength(0)
    const done = await outbox()
    expect(done.status).toBe('done'); expect(done.payload.token).toBeUndefined()
  })
  it('retries, without mailing, while the tenant has no usable origin', async () => {
    await issue()
    expect(await sendInvitationOutbox(pool, { mail, returnOrigin: tenantReturnOrigin(pool, ['https://*.saas.example']) })).toEqual({ sent: 0, failed: 0 })
    expect(sent).toHaveLength(0)
    expect((await outbox()).status).toBe('pending')
    expect((await pool.query('SELECT delivery_status FROM admin_invitations')).rows[0].delivery_status).not.toBe('failed')
  })
  it('records local_capture for local SMTP host', async () => {
    await issue(); await sendInvitationOutbox(pool, { mail, returnOrigin: fixedReturnOrigin('http://localhost:3000'), smtpHost: '127.0.0.1' })
    expect((await pool.query('SELECT delivery_status FROM admin_invitations')).rows[0].delivery_status).toBe('local_capture')
  })
  it('single use, sets password once', async () => {
    await issue(); await sendInvitationOutbox(pool, { mail, returnOrigin: fixedReturnOrigin('https://app.liwan.test') })
    const token = tokenOf()
    await acceptInvitation(pool, { token, password: PW, tenant_id: tenant, setPassword })
    await expect(acceptInvitation(pool, { token, password: PW, tenant_id: tenant, setPassword })).rejects.toBeInstanceOf(InvitationError)
    expect(set).toHaveLength(1)
  })
  it('rejects short passwords, wrong tokens, and expired', async () => {
    await issue(); await sendInvitationOutbox(pool, { mail, returnOrigin: fixedReturnOrigin('https://app.liwan.test') })
    const token = tokenOf()
    await expect(acceptInvitation(pool, { token, password: 'short', tenant_id: tenant, setPassword })).rejects.toThrow('invalid')
    await expect(acceptInvitation(pool, { token: 'x'.repeat(43), password: PW, tenant_id: tenant, setPassword })).rejects.toThrow('invalid')
    await pool.query(`UPDATE admin_invitations SET expires_at = now() - interval '1 second'`)
    await expect(acceptInvitation(pool, { token, password: PW, tenant_id: tenant, setPassword })).rejects.toThrow('invalid')
  })
  it('a new issue revokes the previous token', async () => {
    await issue(); await sendInvitationOutbox(pool, { mail, returnOrigin: fixedReturnOrigin('https://app.liwan.test') }); const old = tokenOf()
    await issue(); await sendInvitationOutbox(pool, { mail, returnOrigin: fixedReturnOrigin('https://app.liwan.test') }); const fresh = tokenOf()
    await expect(acceptInvitation(pool, { token: old, password: PW, tenant_id: tenant, setPassword })).rejects.toThrow('invalid')
    await acceptInvitation(pool, { token: fresh, password: PW, tenant_id: tenant, setPassword })
  })
  it('does not fake success when no password setter exists and keeps invitation usable', async () => {
    await issue(); await sendInvitationOutbox(pool, { mail, returnOrigin: fixedReturnOrigin('https://app.liwan.test') }); const token = tokenOf()
    await expect(acceptInvitation(pool, { token, password: PW, tenant_id: tenant })).rejects.toThrow('password_setter_unavailable')
    await acceptInvitation(pool, { token, password: PW, tenant_id: tenant, setPassword })
  })
  it('public http returns one generic error', async () => {
    const r = await invitationHttp(pool, { method: 'POST', pathname: '/v1/invitations/accept', raw: JSON.stringify({ token: 'y'.repeat(43), password: PW }), issuer: 'i', actor: 1, capabilities: [] })
      .catch((e) => e)
    expect(r.status).toBe(400); expect(r.code).toBe('invalid_invitation')
  })
    const accept = (token: string, setter?: (x: any) => Promise<void>, o: { tenant?: string } = {}) =>
      invitationHttp(pool, { method: 'POST', pathname: '/v1/invitations/accept', raw: JSON.stringify({ token, password: PW }), issuer: 'i', actor: 1, capabilities: [], tenant: o.tenant ?? tenant, setPassword: setter }).catch((e) => e)
  it.each([
    ['password_policy', 422, 'password_rejected'],
    ['user_missing', 409, 'account_unavailable'],
    ['user_inactive', 409, 'account_unavailable'],
    ['database_invalid', 409, 'account_unavailable'],
    ['busy', 409, 'in_progress'],
    ['script_failed', 503, 'unavailable'],
    ['unavailable', 503, 'unavailable'],
    ['something_unexpected', 503, 'unavailable'],
  ])('maps setter failure %s to %i %s and keeps the invitation usable', async (failure, status, code) => {
    await issue(); await sendInvitationOutbox(pool, { mail, returnOrigin: fixedReturnOrigin('https://app.liwan.test') }); const token = tokenOf()
    const r = await accept(token, async () => { throw new InvitationError(failure) })
    expect(r.status).toBe(status); expect(r.code).toBe(code)
    expect(JSON.stringify(r).includes(PW)).toBe(false)
    expect((await accept(token, setPassword)).status).toBe(200)
    expect(set).toHaveLength(1)
  })
  it('passes the invitation token to the setter', async () => {
    await issue(); await sendInvitationOutbox(pool, { mail, returnOrigin: fixedReturnOrigin('https://app.liwan.test') }); const token = tokenOf()
    let seen: any
    await accept(token, async (x) => { seen = x })
    expect(seen.token === token && seen.password === PW && seen.admin_login === 'admin@x.test' && seen.tenant_id === tenant).toBe(true)
  })
  it('answers 400 for an invalid token even when the setter would report password_policy', async () => {
    let called = false
    const r = await accept('z'.repeat(43), async () => { called = true; throw new InvitationError('password_policy') })
    expect(r.status).toBe(400); expect(r.code).toBe('invalid_invitation'); expect(called).toBe(false)
  })
  it('answers 503 when the channel is not configured and keeps the invitation usable', async () => {
    await issue(); await sendInvitationOutbox(pool, { mail, returnOrigin: fixedReturnOrigin('https://app.liwan.test') }); const token = tokenOf()
    const r = await accept(token)
    expect(r.status).toBe(503); expect(r.code).toBe('unavailable')
    expect((await accept(token, setPassword)).status).toBe(200)
  })
  it('rejects an over-length password with 422 and an over-length token with 400 before consuming the token', async () => {
    await issue(); await sendInvitationOutbox(pool, { mail, returnOrigin: fixedReturnOrigin('https://app.liwan.test') }); const token = tokenOf()
    let called = false
    const watch = async (x: any) => { called = true; await setPassword(x) }
    const longPassword = await invitationHttp(pool, { method: 'POST', pathname: '/v1/invitations/accept', raw: JSON.stringify({ token, password: 'p'.repeat(257) }), issuer: 'i', actor: 1, capabilities: [], tenant, setPassword: watch }).catch((e) => e)
    expect(longPassword.status).toBe(422); expect(longPassword.code).toBe('password_rejected')
    const longToken = await accept(token + 'x'.repeat(200), watch)
    expect(longToken.status).toBe(400); expect(longToken.code).toBe('invalid_invitation')
    expect(called).toBe(false)
    expect((await pool.query('SELECT consumed_at FROM admin_invitations')).rows[0].consumed_at).toBeNull()
    expect((await accept(token, setPassword)).status).toBe(200)
  })
  it('answers 409 in_progress to a concurrent accept of the same token while the first setter runs', async () => {
    await issue(); await sendInvitationOutbox(pool, { mail, returnOrigin: fixedReturnOrigin('https://app.liwan.test') }); const token = tokenOf()
    let release!: () => void, entered!: () => void
    const inside = new Promise<void>(r => { entered = r })
    const first = accept(token, () => new Promise<void>(r => { entered(); release = r }))
    await inside
    const second = await accept(token, setPassword)
    expect(second.status).toBe(409); expect(second.code).toBe('in_progress')
    release()
    expect((await first).status).toBe(200)
    expect(set).toHaveLength(0)
  }, 20000)
  const check = async (token: unknown) => (await invitationHttp(pool, { method: 'POST', pathname: '/v1/invitations/check', raw: JSON.stringify({ token }), issuer: 'i', actor: 1, capabilities: [] }))!
  it('check answers usable only for a live invitation and one identical shape otherwise, with no side effects', async () => {
    await issue(); await sendInvitationOutbox(pool, { mail, returnOrigin: fixedReturnOrigin('https://app.liwan.test') }); const token = tokenOf()
    const before = JSON.stringify((await pool.query('SELECT * FROM admin_invitations')).rows)
    expect(await check(token)).toEqual({ status: 200, data: { usable: true } })
    expect(await check(token)).toEqual({ status: 200, data: { usable: true } })
    expect(JSON.stringify((await pool.query('SELECT * FROM admin_invitations')).rows)).toBe(before)
    const unusable = { status: 200, data: { usable: false } }
    expect(await check('z'.repeat(43))).toEqual(unusable)
    expect(await check('short')).toEqual(unusable)
    expect(await check(undefined)).toEqual(unusable)
    await pool.query("UPDATE admin_invitations SET expires_at=now() - interval '1 second'")
    expect(await check(token)).toEqual(unusable)
    await pool.query("UPDATE admin_invitations SET expires_at=now() + interval '1 hour', revoked_at=now()")
    expect(await check(token)).toEqual(unusable)
    await pool.query('UPDATE admin_invitations SET revoked_at=NULL')
    await acceptInvitation(pool, { token, password: PW, tenant_id: tenant, setPassword })
    expect(await check(token)).toEqual(unusable)
  })
  it('check rejects non-POST and malformed bodies without a token oracle', async () => {
    await expect(invitationHttp(pool, { method: 'GET', pathname: '/v1/invitations/check', raw: '', issuer: 'i', actor: 1, capabilities: [] })).rejects.toMatchObject({ status: 404 })
    expect(await invitationHttp(pool, { method: 'POST', pathname: '/v1/invitations/check', raw: 'not json', issuer: 'i', actor: 1, capabilities: [] })).toEqual({ status: 200, data: { usable: false } })
  })
  it('check over HTTP is rate limited per client and does not spend the accept budget', async () => {
    const config = { installationId: 'inv-check', key: 'vendor-test-key-'.repeat(4), customerCommercialIssuer: 'i', customerCommercialServiceKey: 'customer-test-key-'.repeat(4),
      inventoryPath: '', repositoryRoot: '', python: 'python3', stateDir: '' }
    const server = createApp(pool, config).listen(0, '127.0.0.1')
    await new Promise<void>(resolve => server.once('listening', resolve))
    try {
      const addr = server.address(); if (!addr || typeof addr === 'string') throw Error('missing address')
      const post = (path: string, body: unknown) => fetch(`http://127.0.0.1:${addr.port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const statuses: number[] = []
      for (let n = 0; n < 11; n++) statuses.push((await post('/v1/invitations/check', { token: 'q'.repeat(43) })).status)
      expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200))
      const limited = await post('/v1/invitations/check', { token: 'q'.repeat(43) })
      expect(statuses[10]).toBe(429); expect(limited.status).toBe(429)
      expect((await post('/v1/invitations/accept', { token: 'q'.repeat(43), password: PW })).status).toBe(400)
    } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
  })
  it('keys the invitation limit on the address the BFF signed, and ignores an unsigned or forged one', async () => {
    const key = 'customer-test-key-'.repeat(4)
    const config = { installationId: 'inv-bff', key: 'vendor-test-key-'.repeat(4), customerCommercialIssuer: 'i', customerCommercialServiceKey: key,
      inventoryPath: '', repositoryRoot: '', python: 'python3', stateDir: '' }
    const server = createApp(pool, config).listen(0, '127.0.0.1')
    await new Promise<void>(resolve => server.once('listening', resolve))
    try {
      const addr = server.address(); if (!addr || typeof addr === 'string') throw Error('missing address')
      const path = '/v1/invitations/check'
      const post = (headers: Record<string, string> = {}) => fetch(`http://127.0.0.1:${addr.port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ token: 'q'.repeat(43) }) })
      const signed = (ip: string, signingKey = key) => ({ 'x-liwan-client-ip': ip, ...signServiceRequest({ method: 'POST', path, body: `liwan-invitation-client:${ip}\n`, actor: 'anonymous', anonymous: true, issuer: 'i', key: signingKey }) })
      for (let n = 0; n < 10; n++) expect((await post(signed('203.0.113.7'))).status).toBe(200)
      expect((await post(signed('203.0.113.7'))).status).toBe(429)
      expect((await post(signed('203.0.113.8'))).status).toBe(200) // another visitor behind the same BFF
      // Forged: a header without a valid signature, or signed with another key, is the BFF's own socket address.
      for (let n = 0; n < 10; n++) expect((await post(n % 2 ? { 'x-liwan-client-ip': `198.51.100.${n}` } : signed(`198.51.100.${n}`, 'forged-test-key-'.repeat(4)))).status).toBe(200)
      expect((await post({ 'x-liwan-client-ip': '198.51.100.99' })).status).toBe(429)
    } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
  })
  describe('self-signup handoff invitations', () => {
    beforeEach(async () => { await pool.query(`UPDATE customers SET admin_login='admin@x.test' WHERE id=$1`, [customer]) })
    const handoff = () => issueHandoffInvitation(pool, customer)
    it('issues a one-time link that lives 15 minutes and queues no email', async () => {
      const before = Date.now()
      const h = await handoff()
      expect(h.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(h.expiresAt.getTime()).toBeGreaterThanOrEqual(before + HANDOFF_INVITATION_TTL_SECONDS * 1000 - 1000)
      expect(h.expiresAt.getTime()).toBeLessThanOrEqual(before + HANDOFF_INVITATION_TTL_SECONDS * 1000 + 1000)
      expect((await pool.query('SELECT count(*)::int AS n FROM commercial_outbox')).rows[0].n).toBe(0)
      const row = (await pool.query('SELECT delivery_status,revoked_at,consumed_at,token_hash FROM admin_invitations')).rows[0]
      expect(row).toMatchObject({ delivery_status: 'handoff', revoked_at: null, consumed_at: null })
      expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/)
      expect(JSON.stringify(row)).not.toContain(h.token)
    })
    it('refreshing the waiting page issues again, so only the newest link works', async () => {
      const first = await handoff(); const second = await handoff()
      expect(second.token).not.toBe(first.token)
      await expect(acceptInvitation(pool, { token: first.token, password: PW, tenant_id: tenant, setPassword })).rejects.toThrow('invalid')
      expect(set).toHaveLength(0)
      await acceptInvitation(pool, { token: second.token, password: PW, tenant_id: tenant, setPassword })
      expect(set).toHaveLength(1)
    })
    it('accept consumes the invitation only for the workspace the verified request names', async () => {
      const h = await handoff()
      const wrong = await accept(h.token, undefined, { tenant: randomUUID() })
      expect(wrong.status).toBe(400); expect(wrong.code).toBe('invalid_invitation')
      expect(set).toHaveLength(0)
      expect((await pool.query('SELECT consumed_at FROM admin_invitations')).rows[0].consumed_at).toBeNull()
      const ok = await accept(h.token, setPassword)
      expect(ok.status).toBe(200); expect(ok.data).toEqual({ ok: true })
      expect(set).toHaveLength(1)
    })
    it('over HTTP the accept must carry the signed workspace header: another workspace, unsigned or malformed is 400, the right one succeeds', async () => {
      const key = 'customer-test-key-'.repeat(4)
      const config = { installationId: 'inv-accept', key: 'vendor-test-key-'.repeat(4), customerCommercialIssuer: 'i', customerCommercialServiceKey: key,
        internalEffect: { key: 'e'.repeat(32), url: 'https://127.0.0.1:1', ca: Buffer.from('test') },
        inventoryPath: '', repositoryRoot: '', python: 'python3', stateDir: '' }
      // In shared mode the route builds its setter from the internal effect client (stubbed at the top of this file).
      vi.stubEnv('LIWAN_TENANCY_MODE', 'shared')
      const server = createApp(pool, config).listen(0, '127.0.0.1')
      await new Promise<void>(resolve => server.once('listening', resolve))
      try {
        const addr = server.address(); if (!addr || typeof addr === 'string') throw Error('missing address')
        const h = await handoff()
        const post = (headers: Record<string, string>) => fetch(`http://127.0.0.1:${addr.port}${ACCEPT_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ token: h.token, password: PW }) })
        const signed = (tid: string) => ({ 'x-liwan-tenant': tid, ...signServiceRequest({ method: 'POST', path: ACCEPT_PATH, body: `liwan-invitation-accept:${tid}\n`, actor: 'anonymous', anonymous: true, issuer: 'i', key }) })
        expect((await post(signed(randomUUID()))).status).toBe(400)
        expect((await post({ 'x-liwan-tenant': tenant })).status).toBe(400)
        expect((await post(signed('Not A Tenant'))).status).toBe(400)
        expect(effectSet).toHaveLength(0)
        expect((await pool.query('SELECT consumed_at FROM admin_invitations')).rows[0].consumed_at).toBeNull()
        expect((await post(signed(tenant))).status).toBe(200)
        expect(effectSet).toHaveLength(1)
        expect((await post(signed(tenant))).status).toBe(400)
      } finally { await new Promise<void>(resolve => server.close(() => resolve())); vi.unstubAllEnvs() }
    })
  })

  describe('first activation on receipt', () => {
    /** A minimal delivered-provisioning fixture: one subscription with its target revision and the effect row applyReceipt expects. */
    const firstActivation = async () => {
      const sub = randomUUID(), rev = randomUUID(), order = randomUUID(), quote = randomUUID()
      const digest = 'a'.repeat(64)
      await pool.query('INSERT INTO subscriptions(id,customer_id,tenant_id) VALUES($1,$2,$3)', [sub, customer, tenant])
      await pool.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,$3,$4)',
        [rev, sub, { entitlement: { digest, modules: [], features: {} }, period_end: '2027-01-01' }, quote])
      await pool.query('UPDATE subscriptions SET target_revision_id=$2,revision=revision+1 WHERE id=$1', [sub, rev])
      await pool.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent)
        VALUES($1,$2,$3,'new',$4,$5,'not_required','queued',$6,'test',0,'SAR',2)`, [order, customer, sub, quote, rev, randomUUID()])
      await pool.query('INSERT INTO fulfillment_effects(id,order_id,operation_id) VALUES($1,$2,$3)', [randomUUID(), order, 'op-' + randomUUID()])
      return { sub, order, rev, digest }
    }
    const receipt = (s: { order: string; rev: string; digest: string }, adminUserId?: number) => ({
      order_id: s.order, tenant_id: tenant, target_revision_id: s.rev, observed_entitlement_digest: s.digest,
      observed_at: new Date().toISOString(), branch_bindings: [], root_company_id: 1,
      ...(adminUserId === undefined ? {} : { admin_user_id: adminUserId }) })
    const enqueued = async (sub: string) => (await pool.query("SELECT count(*)::int AS n FROM commercial_outbox WHERE kind='invitation.issue' AND aggregate_id=$1", [sub])).rows[0].n
    it('enqueues the email invitation for a team-created customer, once, and a replay adds no second one', async () => {
      const s = await firstActivation()
      expect(await applyReceipt(pool, { order_id: s.order, receipt: receipt(s) })).toEqual({ applied: true, replay: false })
      expect(await enqueued(s.sub)).toBe(1)
      expect(await applyReceipt(pool, { order_id: s.order, receipt: receipt(s) })).toEqual({ applied: true, replay: true })
      expect(await enqueued(s.sub)).toBe(1)
    })
    it('a signup-trial customer gets no email invitation and a receipt without an observed administrator leaves the trial waiting', async () => {
      const email = `f${customer}@signup.test`, mobile = `+9665${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
      await pool.query('INSERT INTO public_signup_trials(customer_id,email,mobile,requires_first_login) VALUES($1,$2,$3,true)', [customer, email, mobile])
      const s = await firstActivation()
      await applyReceipt(pool, { order_id: s.order, receipt: receipt(s) })
      expect(await enqueued(s.sub)).toBe(0)
      expect((await pool.query('SELECT first_admin_user_id FROM public_signup_trials WHERE customer_id=$1', [customer])).rows[0].first_admin_user_id).toBeNull()
    })
    it('accepting the founder invitation writes no first_admin_user_id; only the provisioning receipt does', async () => {
      const email = `f${customer}@signup.test`, mobile = `+9665${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
      await pool.query('INSERT INTO public_signup_trials(customer_id,email,mobile,requires_first_login) VALUES($1,$2,$3,true)', [customer, email, mobile])
      await pool.query(`UPDATE customers SET admin_login=$2 WHERE id=$1`, [customer, email])
      const h = await issueHandoffInvitation(pool, customer)
      await acceptInvitation(pool, { token: h.token, password: PW, tenant_id: tenant, setPassword })
      expect(set).toHaveLength(1)
      expect((await pool.query('SELECT first_admin_user_id FROM public_signup_trials WHERE customer_id=$1', [customer])).rows[0].first_admin_user_id).toBeNull()
      const s = await firstActivation()
      await applyReceipt(pool, { order_id: s.order, receipt: receipt(s, 7) })
      expect((await pool.query('SELECT first_admin_user_id FROM public_signup_trials WHERE customer_id=$1', [customer])).rows[0].first_admin_user_id).toBe(7)
    })
  })
  const port = process.env.LIWAN_MAILPIT_SMTP_PORT, api = process.env.LIWAN_MAILPIT_API_PORT
  ;(port && api ? it : it.skip)('Mailpit integration', async () => {
    await issue()
    const smtp = new SmtpMailAdapter({ host: '127.0.0.1', port: Number(port), from: 'LiwanOS <no-reply@liwan.test>', requireTls: false })
    expect((await sendInvitationOutbox(pool, { mail: smtp, returnOrigin: fixedReturnOrigin('http://localhost:3000'), smtpHost: '127.0.0.1' })).sent).toBe(1)
    const list = await (await fetch(`http://127.0.0.1:${api}/api/v1/messages`)).json() as any
    expect(JSON.stringify(list)).toContain('admin@x.test')
  })
})
