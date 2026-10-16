import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { auditListQuerySchema, auditListSchema } from '@nasq/commercial-contracts'
import { vendorSession } from './helpers/vendor-session.js'
import { createApp } from '../http.js'
import { listAudit } from '../audit-feed.js'
import { migrate } from '../db.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
if (url) {
  const parsed = new URL(url)
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname) || !/^nasq_control_scratch_[a-z0-9_]+$/.test(parsed.pathname.slice(1))) throw Error('Requires isolated loopback scratch database')
}

describe('audit list query contract', () => {
  it('accepts the documented filters and rejects anything else', () => {
    expect(auditListQuerySchema.parse({ q: ' acme ', action: 'order.accepted', from: '2026-10-01', to: '2026-10-02', page: '2' })).toMatchObject({ q: 'acme', page: 2 })
    for (const bad of [{ action: 'Order;DROP' }, { from: '2026-13-40' }, { customer_id: 'x' }, { page: '0' }, { page: 'abc' }, { unknown: '1' }, { from: '2026-10-03', to: '2026-10-02' }, { q: '' }]) {
      expect(auditListQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })
})

describe.skipIf(!url)('audit filters on PostgreSQL', () => {
  const pool = new Pool({ connectionString: url })
  const config = { installationId: 'audit-feed-test', key: 'synthetic-audit-key-'.repeat(4), inventoryPath: '/unused', stateDir: '/unused', repositoryRoot: '/unused', python: 'python3' }
  const server = createApp(pool, config)
  const tenant = randomUUID(), customer = randomUUID(), subscription = randomUUID(), orphanTenant = randomUUID()
  const otherCustomer = randomUUID(), otherTenant = randomUUID(), plan = randomUUID(), planId = randomUUID()
  let origin: string, ownerHeaders: (method: string, path: string) => Record<string, string>, outsiderHeaders: (method: string, path: string) => Record<string, string>
  let accountId: number
  async function event(actor: string, action: string, subject: string, reason: string, at: string, metadata: unknown = {}) {
    await pool.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), actor, action, subject, reason, JSON.stringify(metadata), at])
  }
  const ids = async (query: Record<string, unknown>) => (await listAudit(pool, auditListQuerySchema.parse(query))).items.map(item => item.reason)
  beforeAll(async () => {
    await migrate(pool)
    await pool.query('TRUNCATE audit_events, tenants, customers, vendor_accounts, plan_revisions, commercial_plans CASCADE')
    const owner = await vendorSession(pool, config.installationId, ['owner'], { key: config.key })
    const outsider = await vendorSession(pool, config.installationId, ['finance'], { key: config.key })
    ownerHeaders = owner.headers; outsiderHeaders = outsider.headers; accountId = owner.accountId
    await pool.query("UPDATE vendor_accounts SET display_name='Layla Operator' WHERE id=$1", [accountId])
    for (const [id, name] of [[tenant, 'Acme Workspace'], [orphanTenant, 'Lonely Workspace'], [otherTenant, 'Other Workspace']]) await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,$2,'saas','managed',$3,false)", [id, name, `target-${name}`])
    await pool.query('INSERT INTO customers(id,name,tenant_id) VALUES($1,$2,$3),($4,$5,$6)', [customer, 'Acme Trading', tenant, otherCustomer, 'Other Co', otherTenant])
    await pool.query("INSERT INTO subscriptions(id,customer_id,tenant_id,state) VALUES($1,$2,$3,'active')", [subscription, customer, tenant])
    await pool.query("INSERT INTO commercial_plans(id) VALUES($1)", [planId])
    const actor = `account:${accountId}`
    await event(actor, 'order.accepted', subscription, 'accepted a_b%', '2026-10-01T10:00:00Z', { customer_id: customer })
    await event(actor, 'tenant.registered', tenant, 'registered workspace', '2026-10-02T23:30:00Z')
    await event('operator', 'catalog.imported', randomUUID(), 'imported catalog', '2026-10-03T00:00:00Z')
    await event('anonymous', 'auth.failed', `account:${accountId}`, 'bad password', '2026-10-04T08:00:00Z')
    await event(actor, 'tenant.registered', orphanTenant, 'registered lonely', '2026-10-05T08:00:00Z')
    await event(actor, 'customer_terms.created', customer, 'terms for the customer', '2026-10-06T08:00:00Z')
    await event(actor, 'tenant.registered', otherTenant, 'registered other', '2026-10-07T08:00:00Z')
    await event(actor, 'plan.created', plan, 'Plan draft', '2026-10-08T08:00:00Z')
    await event('legacy-uid:2', 'order.cancelled', randomUUID(), 'unrelated order', '2026-10-09T08:00:00Z', { customer_id: otherCustomer })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw Error('No address')
    origin = `http://127.0.0.1:${address.port}`
  })
  afterAll(async () => { await pool.query('TRUNCATE audit_events, tenants, customers, vendor_accounts, commercial_plans CASCADE'); await new Promise<void>(resolve => server.close(() => resolve())); await pool.end() })

  it('lists newest first, valid against the contract, with resolved names', async () => {
    const result = auditListSchema.parse(await listAudit(pool, {}))
    expect(result.total).toBe(9)
    expect(result.items[0]).toMatchObject({ reason: 'unrelated order', subject_ref: { kind: 'other', name: null } })
    const registered = result.items.find(item => item.reason === 'registered workspace')!
    expect(registered).toMatchObject({ actor_name: 'Layla Operator', subject_ref: { kind: 'tenant', name: 'Acme Workspace', customer_id: customer, tenant_id: tenant } })
    expect(result.items.find(item => item.reason === 'terms for the customer')!.subject_ref).toMatchObject({ kind: 'customer', name: 'Acme Trading', customer_id: customer })
    expect(result.items.find(item => item.reason === 'accepted a_b%')!.subject_ref).toMatchObject({ kind: 'other', name: null, customer_id: null })
    expect(result.items.find(item => item.reason === 'registered lonely')!.subject_ref).toMatchObject({ kind: 'tenant', customer_id: null, tenant_id: orphanTenant })
    expect(result.items.find(item => item.reason === 'bad password')!).toMatchObject({ actor_name: null, subject_ref: { kind: 'account', name: 'Layla Operator' } })
  })
  it('filters by action exactly and by family', async () => {
    expect(await ids({ action: 'tenant.registered' })).toHaveLength(3)
    expect(await ids({ action: 'tenant' })).toHaveLength(3)
    expect(await ids({ action: 'order' })).toEqual(['unrelated order', 'accepted a_b%'])
    expect(await ids({ action: 'ord' })).toEqual([])
  })
  it('filters by actor text and by actor name', async () => {
    expect(await ids({ actor: 'anonym' })).toEqual(['bad password'])
    expect(await ids({ actor: 'layla' })).toHaveLength(6)
    expect(await ids({ actor: 'legacy-uid' })).toEqual(['unrelated order'])
  })
  it('filters by exact subject', async () => {
    expect(await ids({ subject: tenant })).toEqual(['registered workspace'])
    expect(await ids({ subject: tenant.slice(0, 8) })).toEqual([])
  })
  it('filters by inclusive UTC day range', async () => {
    expect(await ids({ from: '2026-10-02', to: '2026-10-03' })).toEqual(['imported catalog', 'registered workspace'])
    expect(await ids({ from: '2026-10-09' })).toEqual(['unrelated order'])
    expect(await ids({ to: '2026-10-01' })).toEqual(['accepted a_b%'])
  })
  it('searches text, wildcards literally, and names behind ids', async () => {
    expect(await ids({ q: 'a_b%' })).toEqual(['accepted a_b%'])
    expect(await ids({ q: '%' })).toEqual(['accepted a_b%'])
    expect(await ids({ q: 'a_b_' })).toEqual([])
    expect(await ids({ q: 'acme workspace' })).toEqual(['registered workspace'])
    expect(await ids({ q: 'acme trading' })).toEqual(['terms for the customer'])
    expect(await ids({ q: 'LAYLA' })).toHaveLength(7)
    expect(await ids({ q: "x' OR 1=1 --" })).toEqual([])
  })
  it("limits to a customer's own records (customer, workspace, orders, metadata) and combines with other filters", async () => {
    expect(await ids({ customer_id: customer })).toEqual(['terms for the customer', 'registered workspace', 'accepted a_b%'])
    expect(await ids({ customer_id: customer, action: 'tenant' })).toEqual(['registered workspace'])
    expect(await ids({ customer_id: customer, from: '2026-10-02', to: '2026-10-02' })).toEqual(['registered workspace'])
    expect(await ids({ customer_id: randomUUID() })).toEqual([])
  })
  it('names a plan revision subject', async () => {
    await pool.query("INSERT INTO plan_revisions(id,plan_id,version,name,audience,term_months,currency,prices,platform_limits,included_bundle_revision_ids,optional_bundle_revision_ids,included_extra_branches,extra_branch_prices,policy_revision_id,trial_days,grace_days,auto_suspend,auto_renew_allowed,content_digest) VALUES($1,$2,1,'Gold Plan','{}',12,'SAR','[]','{}','[]','[]',0,'[]','6f1c3d8e-0000-4000-8000-000000000001',0,7,true,true,'digest')", [plan, planId])
    expect((await listAudit(pool, { action: 'plan.created' })).items[0]!.subject_ref).toMatchObject({ kind: 'plan', name: 'Gold Plan' })
    expect(await ids({ q: 'gold' })).toEqual(['Plan draft'])
  })
  it('pages 25 at a time and keeps the total past the last page', async () => {
    for (let i = 0; i < 30; i++) await event('operator', 'bulk.event', 'shared-registry', `bulk ${i}`, '2026-11-01T00:00:00Z')
    const first = await listAudit(pool, { action: 'bulk', page: 1 }), second = await listAudit(pool, { action: 'bulk', page: 2 }), beyond = await listAudit(pool, { action: 'bulk', page: 3 })
    expect([first.items.length, second.items.length, first.total, second.total]).toEqual([25, 5, 30, 30])
    expect(beyond).toEqual({ items: [], total: 0 })
  })
  it('serves the filters over HTTP, rejects invalid ones, and keeps the capability gate', async () => {
    const get = (path: string, headers = ownerHeaders) => fetch(origin + path, { headers: headers('GET', path) })
    const ok = await get(`/v1/audit?action=tenant&customer_id=${customer}`)
    expect(ok.status).toBe(200)
    expect(auditListSchema.parse(await ok.json()).items.map(item => item.reason)).toEqual(['registered workspace'])
    for (const query of ['action=Bad%20Value', 'from=nope', `customer_id=x`, 'page=0', 'extra=1']) expect((await get(`/v1/audit?${query}`)).status, query).toBe(422)
    expect((await get('/v1/audit', outsiderHeaders)).status).toBe(403)
  })
})
