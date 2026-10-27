import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { url, setup } from './commercial-helpers.js'
import { acceptInvitation, issueInvitation, sendInvitationOutbox, InvitationError } from '../commercial/invitations.js'
import { isAllowedInvitationOrigin } from '../commercial/invitation-tokens.js'
import { invitationHttp } from '../commercial/invitation-http.js'
import { SmtpMailAdapter, type MailAdapter, type MailMessage } from '../commercial/mail-adapter.js'
import { createApp } from '../http.js'
import { fixedReturnOrigin, tenantReturnOrigin } from '../commercial/return-origin.js'

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
    sent.length = 0; set.length = 0
    await pool.query('TRUNCATE admin_invitations, commercial_outbox')
    tenant = randomUUID(); customer = randomUUID()
    await pool.query(`INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'T','saas','managed',$2,true)`, [tenant, 'inv-' + tenant])
    await pool.query(`INSERT INTO customers(id,name,tenant_id) VALUES($1,'شركة',$2)`, [customer, tenant])
  })
  const issue = (ttl = 3600) => issueInvitation(pool, { customer_id: customer, tenant_id: tenant, admin_login: 'admin@x.test', ttl_seconds: ttl })

  it('issues, sends via outbox, scrubs token, stores only hash', async () => {
    const inv = await issue()
    expect(await sendInvitationOutbox(pool, { mail, returnOrigin: fixedReturnOrigin('https://app.webvue.test') })).toEqual({ sent: 1, failed: 0 })
    expect(sent[0].to).toBe('admin@x.test')
    const tok = tokenOf()
    const row = (await pool.query('SELECT * FROM admin_invitations WHERE id=$1', [inv.id])).rows[0]
    expect(row.delivery_status).toBe('sent')
    expect(JSON.stringify(row)).not.toContain(tok)
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify((await pool.query('SELECT payload FROM commercial_outbox')).rows)).not.toContain(tok)
  })
  it('never accepts a wildcard origin for an invitation link', () => {
    expect(isAllowedInvitationOrigin('https://*.webvue.sa')).toBe(false)
    expect(isAllowedInvitationOrigin('https://app.webvue.sa')).toBe(true)
  })
  it('links each tenant admin to the tenant\'s own host in shared mode', async () => {
    const bind = async (t: string, host: string) => pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,true,1)', [t, 't' + t.replaceAll('-', '').slice(0, 12), host, 'db_' + t.replaceAll('-', '').slice(0, 12)])
    const key = randomUUID().slice(0, 8)
    await bind(tenant, `acme-${key}.saas.example`)
    await issue()
    const other = { tenant: randomUUID(), customer: randomUUID() }
    await pool.query(`INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'T2','saas','managed',$2,true)`, [other.tenant, 'inv-' + other.tenant])
    await pool.query(`INSERT INTO customers(id,name,tenant_id) VALUES($1,'Two',$2)`, [other.customer, other.tenant])
    await bind(other.tenant, `globex-${key}.saas.example`)
    await issueInvitation(pool, { customer_id: other.customer, tenant_id: other.tenant, admin_login: 'two@x.test', ttl_seconds: 3600 })
    expect(await sendInvitationOutbox(pool, { mail, returnOrigin: tenantReturnOrigin(pool, ['https://*.saas.example']) })).toEqual({ sent: 2, failed: 0 })
    const links = sent.map(m => /https:\/\/[^\s"]+\/invite\/accept/.exec(m.text)![0]).sort()
    expect(links).toEqual([`https://acme-${key}.saas.example/invite/accept`, `https://globex-${key}.saas.example/invite/accept`])
    expect(sent.every(m => !m.text.includes('*'))).toBe(true)
  })
  it('fails the send, without mailing, when the tenant has no usable origin', async () => {
    await issue()
    expect(await sendInvitationOutbox(pool, { mail, returnOrigin: tenantReturnOrigin(pool, ['https://*.saas.example']) })).toEqual({ sent: 0, failed: 1 })
    expect(sent).toHaveLength(0)
    expect((await pool.query('SELECT delivery_status FROM admin_invitations')).rows[0].delivery_status).toBe('failed')
  })
  it('records local_capture for local SMTP host', async () => {
    await issue(); await sendInvitationOutbox(pool, { mail, returnOrigin: fixedReturnOrigin('http://localhost:3000'), smtpHost: '127.0.0.1' })
    expect((await pool.query('SELECT delivery_status FROM admin_invitations')).rows[0].delivery_status).toBe('local_capture')
  })
  it('single use, sets password once', async () => {
    await issue(); await sendInvitationOutbox(pool, { mail, returnOrigin: fixedReturnOrigin('https://app.webvue.test') })
    const token = tokenOf()
    await acceptInvitation(pool, { token, password: PW, setPassword })
    await expect(acceptInvitation(pool, { token, password: PW, setPassword })).rejects.toBeInstanceOf(InvitationError)
    expect(set).toHaveLength(1)
  })
  it('rejects short passwords, wrong tokens, and expired', async () => {
    await issue(); await sendInvitationOutbox(pool, { mail, returnOrigin: fixedReturnOrigin('https://app.webvue.test') })
    const token = tokenOf()
    await expect(acceptInvitation(pool, { token, password: 'short', setPassword })).rejects.toThrow('invalid')
    await expect(acceptInvitation(pool, { token: 'x'.repeat(43), password: PW, setPassword })).rejects.toThrow('invalid')
    await pool.query(`UPDATE admin_invitations SET expires_at = now() - interval '1 second'`)
    await expect(acceptInvitation(pool, { token, password: PW, setPassword })).rejects.toThrow('invalid')
  })
  it('reissue revokes the previous token', async () => {
    await issue(); await sendInvitationOutbox(pool, { mail, returnOrigin: fixedReturnOrigin('https://app.webvue.test') }); const old = tokenOf()
    await issue(); await sendInvitationOutbox(pool, { mail, returnOrigin: fixedReturnOrigin('https://app.webvue.test') }); const fresh = tokenOf()
    await expect(acceptInvitation(pool, { token: old, password: PW, setPassword })).rejects.toThrow('invalid')
    await acceptInvitation(pool, { token: fresh, password: PW, setPassword })
  })
  it('does not fake success when no password setter exists and keeps invitation usable', async () => {
    await issue(); await sendInvitationOutbox(pool, { mail, returnOrigin: fixedReturnOrigin('https://app.webvue.test') }); const token = tokenOf()
    await expect(acceptInvitation(pool, { token, password: PW })).rejects.toThrow('password_setter_unavailable')
    await acceptInvitation(pool, { token, password: PW, setPassword })
  })
  it('public http returns one generic error', async () => {
    const r = await invitationHttp(pool, { method: 'POST', pathname: '/v1/invitations/accept', raw: JSON.stringify({ token: 'y'.repeat(43), password: PW }), issuer: 'i', actor: 1, capabilities: [] })
      .catch((e) => e)
    expect(r.status).toBe(400); expect(r.code).toBe('invalid_invitation')
  })
  const accept = (token: string, setter?: (x: any) => Promise<void>) =>
    invitationHttp(pool, { method: 'POST', pathname: '/v1/invitations/accept', raw: JSON.stringify({ token, password: PW }), issuer: 'i', actor: 1, capabilities: [], setPassword: setter }).catch((e) => e)
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
    await issue(); await sendInvitationOutbox(pool, { mail, returnOrigin: fixedReturnOrigin('https://app.webvue.test') }); const token = tokenOf()
    const r = await accept(token, async () => { throw new InvitationError(failure) })
    expect(r.status).toBe(status); expect(r.code).toBe(code)
    expect(JSON.stringify(r).includes(PW)).toBe(false)
    expect((await accept(token, setPassword)).status).toBe(200)
    expect(set).toHaveLength(1)
  })
  it('passes the invitation token to the setter', async () => {
    await issue(); await sendInvitationOutbox(pool, { mail, returnOrigin: fixedReturnOrigin('https://app.webvue.test') }); const token = tokenOf()
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
    await issue(); await sendInvitationOutbox(pool, { mail, returnOrigin: fixedReturnOrigin('https://app.webvue.test') }); const token = tokenOf()
    const r = await accept(token)
    expect(r.status).toBe(503); expect(r.code).toBe('unavailable')
    expect((await accept(token, setPassword)).status).toBe(200)
  })
  it('rejects an over-length password with 422 and an over-length token with 400 before consuming the token', async () => {
    await issue(); await sendInvitationOutbox(pool, { mail, returnOrigin: fixedReturnOrigin('https://app.webvue.test') }); const token = tokenOf()
    let called = false
    const watch = async (x: any) => { called = true; await setPassword(x) }
    const longPassword = await invitationHttp(pool, { method: 'POST', pathname: '/v1/invitations/accept', raw: JSON.stringify({ token, password: 'p'.repeat(257) }), issuer: 'i', actor: 1, capabilities: [], setPassword: watch }).catch((e) => e)
    expect(longPassword.status).toBe(422); expect(longPassword.code).toBe('password_rejected')
    const longToken = await accept(token + 'x'.repeat(200), watch)
    expect(longToken.status).toBe(400); expect(longToken.code).toBe('invalid_invitation')
    expect(called).toBe(false)
    expect((await pool.query('SELECT consumed_at FROM admin_invitations')).rows[0].consumed_at).toBeNull()
    expect((await accept(token, setPassword)).status).toBe(200)
  })
  it('answers 409 in_progress to a concurrent accept of the same token while the first setter runs', async () => {
    await issue(); await sendInvitationOutbox(pool, { mail, returnOrigin: fixedReturnOrigin('https://app.webvue.test') }); const token = tokenOf()
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
    await issue(); await sendInvitationOutbox(pool, { mail, returnOrigin: fixedReturnOrigin('https://app.webvue.test') }); const token = tokenOf()
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
    await acceptInvitation(pool, { token, password: PW, setPassword })
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
  const port = process.env.WEBVUE_MAILPIT_SMTP_PORT, api = process.env.WEBVUE_MAILPIT_API_PORT
  ;(port && api ? it : it.skip)('Mailpit integration', async () => {
    await issue()
    const smtp = new SmtpMailAdapter({ host: '127.0.0.1', port: Number(port), from: 'WebVue <no-reply@webvue.test>', requireTls: false })
    expect((await sendInvitationOutbox(pool, { mail: smtp, returnOrigin: fixedReturnOrigin('http://localhost:3000'), smtpHost: '127.0.0.1' })).sent).toBe(1)
    const list = await (await fetch(`http://127.0.0.1:${api}/api/v1/messages`)).json() as any
    expect(JSON.stringify(list)).toContain('admin@x.test')
  })
})
