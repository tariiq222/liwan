import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { url, setup } from './commercial-helpers.js'
import { acceptInvitation, issueInvitation, sendInvitationOutbox, InvitationError } from '../commercial/invitations.js'
import { invitationHttp } from '../commercial/invitation-http.js'
import { SmtpMailAdapter, type MailAdapter, type MailMessage } from '../commercial/mail-adapter.js'

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
    expect(await sendInvitationOutbox(pool, { mail, origin: 'https://app.nasq.test' })).toEqual({ sent: 1, failed: 0 })
    expect(sent[0].to).toBe('admin@x.test')
    const tok = tokenOf()
    const row = (await pool.query('SELECT * FROM admin_invitations WHERE id=$1', [inv.id])).rows[0]
    expect(row.delivery_status).toBe('sent')
    expect(JSON.stringify(row)).not.toContain(tok)
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify((await pool.query('SELECT payload FROM commercial_outbox')).rows)).not.toContain(tok)
  })
  it('records local_capture for local SMTP host', async () => {
    await issue(); await sendInvitationOutbox(pool, { mail, origin: 'http://localhost:3000', smtpHost: '127.0.0.1' })
    expect((await pool.query('SELECT delivery_status FROM admin_invitations')).rows[0].delivery_status).toBe('local_capture')
  })
  it('single use, sets password once', async () => {
    await issue(); await sendInvitationOutbox(pool, { mail, origin: 'https://app.nasq.test' })
    const token = tokenOf()
    await acceptInvitation(pool, { token, password: PW, setPassword })
    await expect(acceptInvitation(pool, { token, password: PW, setPassword })).rejects.toBeInstanceOf(InvitationError)
    expect(set).toHaveLength(1)
  })
  it('rejects short passwords, wrong tokens, and expired', async () => {
    await issue(); await sendInvitationOutbox(pool, { mail, origin: 'https://app.nasq.test' })
    const token = tokenOf()
    await expect(acceptInvitation(pool, { token, password: 'short', setPassword })).rejects.toThrow('invalid')
    await expect(acceptInvitation(pool, { token: 'x'.repeat(43), password: PW, setPassword })).rejects.toThrow('invalid')
    await pool.query(`UPDATE admin_invitations SET expires_at = now() - interval '1 second'`)
    await expect(acceptInvitation(pool, { token, password: PW, setPassword })).rejects.toThrow('invalid')
  })
  it('reissue revokes the previous token', async () => {
    await issue(); await sendInvitationOutbox(pool, { mail, origin: 'https://app.nasq.test' }); const old = tokenOf()
    await issue(); await sendInvitationOutbox(pool, { mail, origin: 'https://app.nasq.test' }); const fresh = tokenOf()
    await expect(acceptInvitation(pool, { token: old, password: PW, setPassword })).rejects.toThrow('invalid')
    await acceptInvitation(pool, { token: fresh, password: PW, setPassword })
  })
  it('does not fake success when no password setter exists and keeps invitation usable', async () => {
    await issue(); await sendInvitationOutbox(pool, { mail, origin: 'https://app.nasq.test' }); const token = tokenOf()
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
    await issue(); await sendInvitationOutbox(pool, { mail, origin: 'https://app.nasq.test' }); const token = tokenOf()
    const r = await accept(token, async () => { throw new InvitationError(failure) })
    expect(r.status).toBe(status); expect(r.code).toBe(code)
    expect(JSON.stringify(r).includes(PW)).toBe(false)
    expect((await accept(token, setPassword)).status).toBe(200)
    expect(set).toHaveLength(1)
  })
  it('passes the invitation token to the setter', async () => {
    await issue(); await sendInvitationOutbox(pool, { mail, origin: 'https://app.nasq.test' }); const token = tokenOf()
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
    await issue(); await sendInvitationOutbox(pool, { mail, origin: 'https://app.nasq.test' }); const token = tokenOf()
    const r = await accept(token)
    expect(r.status).toBe(503); expect(r.code).toBe('unavailable')
    expect((await accept(token, setPassword)).status).toBe(200)
  })
  it('rejects an over-length password with 422 and an over-length token with 400 before consuming the token', async () => {
    await issue(); await sendInvitationOutbox(pool, { mail, origin: 'https://app.nasq.test' }); const token = tokenOf()
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
    await issue(); await sendInvitationOutbox(pool, { mail, origin: 'https://app.nasq.test' }); const token = tokenOf()
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
  const port = process.env.NASQ_MAILPIT_SMTP_PORT, api = process.env.NASQ_MAILPIT_API_PORT
  ;(port && api ? it : it.skip)('Mailpit integration', async () => {
    await issue()
    const smtp = new SmtpMailAdapter({ host: '127.0.0.1', port: Number(port), from: 'Nasq <no-reply@nasq.test>', requireTls: false })
    expect((await sendInvitationOutbox(pool, { mail: smtp, origin: 'http://localhost:3000', smtpHost: '127.0.0.1' })).sent).toBe(1)
    const list = await (await fetch(`http://127.0.0.1:${api}/api/v1/messages`)).json() as any
    expect(JSON.stringify(list)).toContain('admin@x.test')
  })
})
