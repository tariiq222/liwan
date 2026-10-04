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
  const port = process.env.NASQ_MAILPIT_SMTP_PORT, api = process.env.NASQ_MAILPIT_API_PORT
  ;(port && api ? it : it.skip)('Mailpit integration', async () => {
    await issue()
    const smtp = new SmtpMailAdapter({ host: '127.0.0.1', port: Number(port), from: 'Nasq <no-reply@nasq.test>', requireTls: false })
    expect((await sendInvitationOutbox(pool, { mail: smtp, origin: 'http://localhost:3000', smtpHost: '127.0.0.1' })).sent).toBe(1)
    const list = await (await fetch(`http://127.0.0.1:${api}/api/v1/messages`)).json() as any
    expect(JSON.stringify(list)).toContain('admin@x.test')
  })
})
