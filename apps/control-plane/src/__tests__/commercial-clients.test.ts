import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { routesB } from '../commercial/routes-b.js'
import { CommercialHttpError } from '../commercial/lifecycle.js'
import { client, ALL, money, monthly, setup, url } from './commercial-helpers.js'

const suite = url ? describe : describe.skip
suite('unified vendor client list on PostgreSQL', () => {
  const pool = new Pool({ connectionString: url })
  const api = client(pool)
  const clients = (caps: any[] = ALL) => async (path: string) => {
    const [pathname, search] = path.split('?')
    try {
      const r = await routesB(pool, { method: 'GET', pathname: `/v1/commercial${pathname}`, search: search ? `?${search}` : '', raw: '', issuer: 'clients-test', actor: 7, capabilities: caps }, new URL(`http://localhost/v1/commercial${path}`))
      return { status: r!.status, body: r!.data as any }
    } catch (e) {
      if (e instanceof CommercialHttpError) return { status: e.status, body: { code: e.code, field: e.field } as any }
      throw e
    }
  }
  const call = (_method: 'GET', path: string) => clients()(path)
  const tag = `cl${randomUUID().slice(0, 8)}`
  const ids = { activeCustomer: randomUUID(), activeTenant: randomUUID(), bareCustomer: randomUUID(), setupCustomer: randomUUID(), lonelyTenant: randomUUID(), pendingCustomer: randomUUID() }
  async function tenant(id: string, name: string, mode = 'saas') {
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,$2,$3,'managed',$4,false)", [id, name, mode, `target-${id}`])
  }
  beforeAll(async () => {
    const { version } = await setup(pool)
    await api('POST', '/catalog/releases', { catalog_version: version, reason: 'clients list fixture' })
    const subscription = randomUUID(), pendingSubscription = randomUUID()
    await tenant(ids.activeTenant, `${tag} active workspace`)
    await tenant(ids.lonelyTenant, `${tag} lonely workspace`, 'non_saas')
    await pool.query('INSERT INTO customers(id,name,tenant_id) VALUES($1,$2,$3)', [ids.activeCustomer, `${tag} active customer`, ids.activeTenant])
    await pool.query('INSERT INTO customers(id,name) VALUES($1,$2)', [ids.bareCustomer, `${tag} bare customer`])
    await pool.query('INSERT INTO customers(id,name,commercial_setup_required) VALUES($1,$2,true)', [ids.setupCustomer, `${tag} setup customer`])
    await pool.query('INSERT INTO customers(id,name) VALUES($1,$2)', [ids.pendingCustomer, `${tag} pending customer`])
    const created = await api('POST', '/plans', { name: `${tag} plan`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR', prices: [{ cadence: monthly, amount: money(10000) }], platform_limits: {}, included_bundle_revision_ids: [], optional_bundle_revision_ids: [], included_extra_branches: 1, extra_branch_prices: [{ cadence: monthly, amount: money(5000) }], extra_branches_limit: null, included_users: 1, included_storage_mb: 0, user_prices: [{ cadence: monthly, amount: money(0) }], storage_prices: [{ cadence: monthly, amount: money(0) }], policy_revision_id: '6f1c3d8e-0000-4000-8000-000000000001', trial_days: 0, grace_days: 0, auto_suspend: true, auto_renew_allowed: true })
    const validated = await api('POST', `/plans/${created.body.id}/validate`, { edit_revision: 1, reason: 'clients list fixture' })
    const revision = (await api('POST', `/plans/${created.body.id}/publish`, { edit_revision: validated.body.edit_revision, reason: 'clients list fixture' })).body.id
    await pool.query("INSERT INTO subscriptions(id,customer_id,tenant_id,state,renewal_at) VALUES($1,$2,$3,'active','2026-12-01')", [subscription, ids.activeCustomer, ids.activeTenant])
    await pool.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,$3,$4)', [randomUUID(), subscription, JSON.stringify({ plan_revision_id: revision }), randomUUID()])
    await pool.query('UPDATE subscriptions SET revision=revision+1, applied_revision_id=(SELECT id FROM subscription_revisions WHERE subscription_id=$1) WHERE id=$1', [subscription])
    await pool.query("INSERT INTO subscriptions(id,customer_id,state) VALUES($1,$2,'pending')", [pendingSubscription, ids.pendingCustomer])
  })
  afterAll(async () => { await pool.end() })
  const find = (items: any[], name: string) => items.find(item => item.name === `${tag} ${name}`)

  it('lists customers with their workspace and workspaces without a customer', async () => {
    const r = await call('GET', `/clients?q=${tag}`)
    expect(r.status).toBe(200)
    expect(r.body.total).toBe(5)
    expect(find(r.body.items, 'active customer')).toEqual({
      customer_id: ids.activeCustomer, tenant_id: ids.activeTenant, name: `${tag} active customer`, subscription_state: 'active', plan_name: `${tag} plan`, pending_plan_name: null,
      renewal_at: '2026-12-01', setup_required: false, tenant_status: 'registered', commercial_mode: 'saas', hosting_model: 'managed',
    })
    expect(find(r.body.items, 'lonely workspace')).toMatchObject({ customer_id: null, tenant_id: ids.lonelyTenant, subscription_state: null, setup_required: false, commercial_mode: 'non_saas' })
    expect(find(r.body.items, 'bare customer')).toMatchObject({ customer_id: ids.bareCustomer, tenant_id: null, subscription_state: null, tenant_status: null, commercial_mode: null })
    expect(find(r.body.items, 'pending customer')).toMatchObject({ subscription_state: 'awaiting_payment', plan_name: null, pending_plan_name: null })
    expect(find(r.body.items, 'setup customer')).toMatchObject({ setup_required: true })
    expect(r.body.items.some((item: any) => item.name === `${tag} active workspace`)).toBe(false)
  })

  it.each([
    ['active', ['active customer']],
    ['awaiting_payment', ['pending customer']],
    ['setup_required', ['bare customer', 'setup customer']],
    ['no_workspace', ['bare customer', 'setup customer', 'pending customer']],
    ['no_commercial', ['lonely workspace']],
  ])('filters by %s', async (state, names) => {
    const r = await call('GET', `/clients?q=${tag}&state=${state}`)
    expect(r.status).toBe(200)
    expect(r.body.items.map((item: any) => item.name.slice(tag.length + 1)).sort()).toEqual([...names].sort())
    expect(r.body.total).toBe(names.length)
  })

  it('pages in stable order and reports the total on an empty page', async () => {
    const all = await call('GET', '/clients')
    expect(all.body.items.length).toBeLessThanOrEqual(25)
    const again = await call('GET', '/clients')
    expect(again.body.items).toEqual(all.body.items)
    const beyond = await call('GET', '/clients?page=9999')
    expect(beyond.body).toEqual({ items: [], total: all.body.total })
  })

  it('treats the search text as data and rejects bad input', async () => {
    expect((await call('GET', `/clients?q=${encodeURIComponent("x'; DROP TABLE customers; --")}`)).body).toEqual({ items: [], total: 0 })
    expect((await pool.query('SELECT count(*)::int AS n FROM customers')).rows[0].n).toBeGreaterThan(0)
    expect((await call('GET', '/clients?state=bogus')).status).toBe(422)
    expect((await call('GET', '/clients?page=0')).status).toBe(422)
    expect((await call('GET', '/clients?page=x')).status).toBe(422)
  })

  it('requires vendor.read', async () => {
    expect((await clients([])('/clients')).status).toBe(403)
  })
})
