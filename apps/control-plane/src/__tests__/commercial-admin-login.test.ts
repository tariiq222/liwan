import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { url } from './commercial-helpers.js'
import { migrate } from '../db.js'
import { routesB } from '../commercial/routes-b.js'
import { CommercialHttpError } from '../commercial/lifecycle.js'
import { issueInvitation, sendInvitationOutbox, DEFAULT_INVITATION_TTL_SECONDS } from '../commercial/invitations.js'
import { confirmDeletion, requestDeletion } from '../commercial/tenant-deletion.js'
import { sendTenantDeletionNotices } from '../commercial/tenant-deletion-notices.js'
import { sendOverLimitNotices } from '../commercial/over-limit-notices.js'
import { sendAdminLoginNotices } from '../commercial/admin-login.js'
import { fixedReturnOrigin } from '../commercial/return-origin.js'

const suite = url ? describe : describe.skip

suite('the vendor changes the address on record of a workspace', () => {
  const pool = new Pool({ connectionString: url, max: 8 })
  const origin = fixedReturnOrigin('https://liwan.test')
  const secret = 'admin-login-secret-'.repeat(3)
  const mails: { to: string; subject: string; text: string }[] = []
  const mail = { send: async (m: any) => { mails.push(m); return { accepted: true, provider_message_id: 'p' } } }
  const mailsTo = (address: string) => mails.filter(m => m.to === address)

  beforeAll(async () => { await migrate(pool) })
  beforeEach(async () => { mails.length = 0; await pool.query('TRUNCATE commercial_outbox') })
  afterAll(async () => { await pool.end() })

  const call = async (customer: string, body: unknown, extra: Record<string, unknown> = {}) => {
    try {
      const r = await routesB(pool, { method: 'PATCH', pathname: `/v1/commercial/customers/${customer}/admin-login`, raw: typeof body === 'string' ? body : JSON.stringify(body), issuer: 'al-test', actor: 7,
        capabilities: ['vendor.read', 'vendor.subscriptions.manage'], stepUpFresh: true, clientAddress: '198.51.100.4', ...extra } as never, new URL(`http://x/v1/commercial/customers/${customer}/admin-login`))
      return { status: r!.status, body: r!.data as any }
    } catch (e) {
      if (e instanceof CommercialHttpError) return { status: e.status, body: { code: e.code } as any }
      throw e
    }
  }
  const change = (customer: string, admin_login: string, extra: Record<string, unknown> = {}) => call(customer, { admin_login, reason: 'The first manager left the company' }, extra)

  /** A customer with a workspace; `activated` means a manager accepted an invitation (a consumed one exists). */
  async function workspace(activated = true) {
    const customer = randomUUID(), tenant = randomUUID(), subscription = randomUUID(), slug = `t${tenant.replaceAll('-', '')}`
    const old = `old-${customer.slice(0, 8)}@example.test`
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled,post_trial_supported,excess_supported) VALUES($1,$2,'saas','shared_managed',$3,true,true,true)", [tenant, 'Acme', slug])
    await pool.query('INSERT INTO customers(id,name,tenant_id,admin_name,admin_login) VALUES($1,$2,$3,$4,$5)', [customer, 'Acme', tenant, 'Manager', old])
    await pool.query("INSERT INTO subscriptions(id,customer_id,tenant_id,state) VALUES($1,$2,$3,'active')", [subscription, customer, tenant])
    if (activated) {
      await issueInvitation(pool, { customer_id: customer, tenant_id: tenant, admin_login: old, ttl_seconds: DEFAULT_INVITATION_TTL_SECONDS })
      await pool.query('UPDATE admin_invitations SET consumed_at=now() WHERE tenant_id=$1', [tenant])
    }
    return { customer, tenant, subscription, old }
  }
  const invitations = async (tenant: string) => (await pool.query('SELECT admin_login,revoked_at,consumed_at FROM admin_invitations WHERE tenant_id=$1 ORDER BY created_at', [tenant])).rows
  const addressOf = async (customer: string) => (await pool.query('SELECT admin_login FROM customers WHERE id=$1', [customer])).rows[0].admin_login as string
  const audits = async (customer: string) => (await pool.query("SELECT actor,reason,metadata FROM audit_events WHERE subject=$1 AND action='customer.admin_login_changed'", [customer])).rows

  it('checks the capability before it looks at the customer, then the step-up, the body and the address', async () => {
    const f = await workspace()
    expect(await change(randomUUID(), 'new@example.test', { capabilities: ['vendor.read'] })).toMatchObject({ status: 403 })
    expect(await change(f.customer, 'new@example.test', { capabilities: ['vendor.read'] })).toMatchObject({ status: 403 })
    expect(await change(f.customer, 'new@example.test', { stepUpFresh: false })).toMatchObject({ status: 403, body: { code: 'step_up_required' } })
    expect(await change('not-a-uuid', 'new@example.test')).toMatchObject({ status: 404 })
    expect(await change(randomUUID(), 'new@example.test')).toMatchObject({ status: 404 })
    for (const bad of [{ admin_login: 'not an email', reason: 'Manager left' }, { admin_login: 'new@example.test', reason: 'x' }, { admin_login: 'new@example.test' }, { reason: 'Manager left' },
      { admin_login: 'new@example.test', reason: 'Manager left', tenant_id: randomUUID() }, { admin_login: `${'a'.repeat(95)}@e.test`, reason: 'Manager left' }])
      expect(await call(f.customer, bad), JSON.stringify(bad)).toMatchObject({ status: 422 })
    expect(await call(f.customer, '{not json')).toMatchObject({ status: 422 })
    expect(await change(f.customer, f.old.toUpperCase())).toMatchObject({ status: 409, body: { code: 'admin_login_unchanged' } })
    expect(await addressOf(f.customer)).toBe(f.old)
    expect(await audits(f.customer)).toHaveLength(0)
  })

  it('refuses a customer that has no workspace yet', async () => {
    const customer = randomUUID()
    await pool.query('INSERT INTO customers(id,name,admin_login) VALUES($1,$2,$3)', [customer, 'Prospect', 'p@example.test'])
    expect(await change(customer, 'new@example.test')).toMatchObject({ status: 409, body: { code: 'no_workspace' } })
    expect(await addressOf(customer)).toBe('p@example.test')
  })

  it('refuses a workspace nobody has activated yet, writing and sending nothing', async () => {
    const f = await workspace(false)
    await issueInvitation(pool, { customer_id: f.customer, tenant_id: f.tenant, admin_login: f.old, ttl_seconds: DEFAULT_INVITATION_TTL_SECONDS })
    expect(await change(f.customer, 'new@example.test')).toMatchObject({ status: 409, body: { code: 'workspace_not_activated' } })
    expect(await call(f.customer, { admin_login: 'new@example.test', dry_run: true })).toMatchObject({ status: 409, body: { code: 'workspace_not_activated' } })
    expect(await addressOf(f.customer)).toBe(f.old)
    expect((await invitations(f.tenant)).every(r => r.revoked_at === null)).toBe(true)
    expect(await audits(f.customer)).toHaveLength(0)
    expect((await pool.query('SELECT 1 FROM commercial_outbox WHERE kind=$1', ['admin_login.notice'])).rowCount).toBe(0)
  })

  it('after a manager activated the workspace: moves where mail goes, revokes unused invitations to the old address, audits and tells both addresses', async () => {
    const f = await workspace()
    await pool.query('UPDATE admin_invitations SET consumed_at=NULL WHERE tenant_id=$1', [f.tenant])
    await issueInvitation(pool, { customer_id: f.customer, tenant_id: f.tenant, admin_login: f.old, ttl_seconds: DEFAULT_INVITATION_TTL_SECONDS })
    await pool.query("UPDATE admin_invitations SET consumed_at=now() WHERE tenant_id=$1 AND revoked_at IS NOT NULL", [f.tenant])
    const unused = (await invitations(f.tenant)).filter(r => r.consumed_at === null && r.revoked_at === null).length
    expect(unused).toBe(1)
    const done = await change(f.customer, 'New.Manager@Example.test')
    expect(done).toMatchObject({ status: 200, body: { change: { admin_login: 'new.manager@example.test', previous_admin_login: f.old, deletion_code_invalidated: false } } })
    expect(done.body.change.invitation_id).toBeUndefined()
    expect(await addressOf(f.customer)).toBe('new.manager@example.test')
    const rows = await invitations(f.tenant)
    expect(rows.filter(r => r.consumed_at === null && r.revoked_at === null)).toHaveLength(0)
    expect(rows.every(r => r.admin_login === f.old)).toBe(true)
    expect(await audits(f.customer)).toEqual([{ actor: 'account:7', reason: 'The first manager left the company',
      metadata: expect.objectContaining({ previous_admin_login: f.old, admin_login: 'new.manager@example.test', client_address: '198.51.100.4' }) }])
    expect(await sendInvitationOutbox(pool, { mail: mail as never, returnOrigin: origin })).toMatchObject({ sent: 0 })
    expect(await sendAdminLoginNotices(pool, { mail, returnOrigin: origin })).toBe(2)
    expect(mailsTo(f.old)).toHaveLength(1)
    expect(mailsTo('new.manager@example.test')).toHaveLength(1)
    const previousNotice = mailsTo(f.old)[0]!
    expect(previousNotice.text).toContain(f.old)
    expect(previousNotice.text).toContain('new.manager@example.test')
    expect(previousNotice.text).toContain('Your workspace: https://liwan.test')
    expect(previousNotice.text).not.toMatch(/https:\/\/liwan\.test\/\S/)
  })

  it('tells both addresses without a workspace line when no origin is known', async () => {
    const f = await workspace()
    expect(await change(f.customer, 'new@example.test')).toMatchObject({ status: 200 })
    expect(await sendAdminLoginNotices(pool, { mail })).toBe(2)
    expect(mails.every(m => !m.text.includes('Your workspace'))).toBe(true)
  })

  it('previews, without writing, how many other customers already hold the address', async () => {
    const f = await workspace()
    const other = await workspace()
    // No other suite uses this address: the count must not depend on the rows earlier suites left.
    const free = `free.${f.customer}@example.test`
    expect(await call(f.customer, { admin_login: free, dry_run: true })).toMatchObject({ status: 200, body: { preview: { other_customers_with_address: 0 } } })
    expect(await call(f.customer, { admin_login: other.old.toUpperCase(), dry_run: true })).toMatchObject({ status: 200, body: { preview: { other_customers_with_address: 1 } } })
    expect(await call(f.customer, { admin_login: free, dry_run: true }, { stepUpFresh: false })).toMatchObject({ status: 403 })
    expect(await call(f.customer, { admin_login: free, dry_run: true }, { capabilities: ['vendor.read'] })).toMatchObject({ status: 403 })
    expect(await addressOf(f.customer)).toBe(f.old)
    expect(await audits(f.customer)).toHaveLength(0)
    // The same address on another customer does not stop a real change.
    expect(await change(f.customer, other.old)).toMatchObject({ status: 200 })
  })

  it('kills a deletion code mailed to the old address and sends the next one to the new address', async () => {
    const f = await workspace()
    const who = { actor: '9', client_address: '203.0.113.9' }
    await requestDeletion(pool, { ...who, customer_id: f.customer, secret })
    const code = (await pool.query("SELECT payload->>'code' AS code FROM commercial_outbox WHERE kind='tenant_deletion.notice'")).rows[0].code as string
    const done = await change(f.customer, 'new@example.test')
    expect(done.body.change.deletion_code_invalidated).toBe(true)
    expect(await audits(f.customer)).toHaveLength(1)
    expect((await pool.query("SELECT 1 FROM audit_events WHERE subject=$1 AND action='tenant_deletion.code_invalidated'", [f.customer])).rowCount).toBe(1)
    // The old code no longer confirms anything, and the unsent mail that carried it is closed without being sent.
    await expect(confirmDeletion(pool, { ...who, customer_id: f.customer, code, company_name: 'Acme', secret })).rejects.toMatchObject({ code: 'invalid_code' })
    await sendTenantDeletionNotices(pool, { mail })
    expect(mails.filter(m => m.text.includes(code))).toHaveLength(0)
    expect((await pool.query("SELECT payload FROM commercial_outbox WHERE kind='tenant_deletion.notice'")).rows.every(r => r.payload.code === undefined)).toBe(true)
    // Asking again reaches the new address; a request with no live code changes nothing the second time.
    await pool.query("DELETE FROM audit_events WHERE action='tenant_deletion.code_sent'")
    await requestDeletion(pool, { ...who, customer_id: f.customer, secret })
    await sendTenantDeletionNotices(pool, { mail, returnOrigin: origin })
    const fresh = mailsTo('new@example.test').find(m => /\b\d{6}\b/.test(m.text))!
    expect(fresh.text).toContain('Your workspace: https://liwan.test')
    expect(mailsTo(f.old).filter(m => /\b\d{6}\b/.test(m.text))).toHaveLength(0)
    await pool.query("DELETE FROM audit_events WHERE action='tenant_deletion.code_sent'")
    const again = await change(f.customer, 'third@example.test')
    expect(again.body.change.deletion_code_invalidated).toBe(true)
  })

  it('sends a notice that was queued before the change to the new address, with the workspace line', async () => {
    const f = await workspace()
    await pool.query("INSERT INTO commercial_outbox(id,kind,aggregate_id,dedupe_key,payload) VALUES($1,'free_base.locked',$2,$3,'{\"cause\":\"refund\"}')", [randomUUID(), f.subscription, randomUUID()])
    expect(await change(f.customer, 'new@example.test')).toMatchObject({ status: 200 })
    expect(await sendOverLimitNotices(pool, { mail, returnOrigin: origin })).toBe(1)
    expect(mailsTo(f.old)).toHaveLength(0)
    const queued = mailsTo('new@example.test')[0]!
    expect(queued.text).toContain('مساحة عملك: https://liwan.test')
    expect(queued.text).toContain('Your workspace: https://liwan.test')
  })

  it('serialises with the tenant invitation lock: two changes at once both apply in turn and each leaves its two notices', async () => {
    const f = await workspace()
    const results = await Promise.all([change(f.customer, 'a@example.test'), change(f.customer, 'b@example.test')])
    expect(results.map(r => r.status)).toEqual([200, 200])
    expect(['a@example.test', 'b@example.test']).toContain(await addressOf(f.customer))
    expect(await audits(f.customer)).toHaveLength(2)
    expect((await pool.query('SELECT 1 FROM commercial_outbox WHERE kind=$1', ['admin_login.notice'])).rowCount).toBe(4)
  })
})
