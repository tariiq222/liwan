import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { subscriptionDisplayState } from '@nasq/commercial-contracts'
import { url } from './commercial-helpers.js'
import { migrate } from '../db.js'
import { routesB } from '../commercial/routes-b.js'
import { getSubscription } from '../commercial/subscriptions.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'

const suite = url ? describe : describe.skip
suite('vendor customer listing and cancellation HTTP boundary', () => {
  const pool = new Pool({ connectionString: url })
  const prefix = `admin-${randomUUID()}`
  const ids = Array.from({ length: 215 }, () => randomUUID())
  const caps: any[] = ['vendor.read', 'vendor.subscriptions.manage', 'vendor.billing.manage']
  async function call(method: string, path: string, body?: unknown, capabilities = caps, runtime?: any) {
    const target = new URL(`/v1/commercial${path}`, 'http://nasq.test')
    return routesB(pool, { method, pathname: target.pathname, raw: body === undefined ? '' : JSON.stringify(body), actor: 7, issuer: 'admin-test', capabilities }, target, runtime) as Promise<any>
  }
  beforeAll(async () => {
    await migrate(pool)
    await pool.query(`INSERT INTO customers(id,name,created_at)
      SELECT id, $2 || ' Customer ' || lpad((ordinality-1)::text,3,'0'), '2026-01-01'::timestamptz + ordinality * interval '1 second'
      FROM unnest($1::uuid[]) WITH ORDINALITY AS x(id,ordinality)`, [ids, prefix])
    await pool.query('INSERT INTO subscriptions(id,customer_id) VALUES($1,$2)', [randomUUID(), ids[0]])
  })
  afterAll(async () => pool.end())
  it('searches before slicing and returns a total larger than the page', async () => {
    const first = await call('GET', `/customers?q=${prefix}&limit=2&offset=0`)
    expect(first.data.total).toBe(215)
    expect(first.data.items.map((x: any) => x.id)).toEqual([ids[214], ids[213]])
    const next = await call('GET', `/customers?q=${prefix}&limit=2&offset=2`)
    expect(next.data.total).toBe(215)
    expect(next.data.items.map((x: any) => x.id)).toEqual([ids[212], ids[211]])
  })
  it('matches names literally and returns an empty page with the filtered total', async () => {
    expect((await call('GET', `/customers?q=${prefix}%20CUSTOMER%20021`)).data.items.map((x: any) => x.id)).toEqual([ids[21]])
    expect((await call('GET', `/customers?q=${prefix}&limit=25&offset=215`)).data).toEqual({ items: [], total: 215 })
    expect((await call('GET', '/customers?q=%25')).data).toEqual({ items: [], total: 0 })
  })
  it('filters subscription state before pagination, including customers older than 200', async () => {
    const result = await call('GET', `/customers?q=${prefix}&state=awaiting_payment&limit=1`)
    expect(result.data.total).toBe(1)
    expect(result.data.items[0]).toMatchObject({ id: ids[0], display_state: 'awaiting_payment' })
    expect((await call('GET', `/customers?q=${prefix}&state=setup_required&limit=1`)).data.total).toBe(214)
  })
  it.each(['limit=0', 'limit=201', 'limit=1.5', 'offset=-1', 'offset=abc', 'state=bad', 'tenant_id=bad'])('rejects invalid query %s', async query => {
    await expect(call('GET', `/customers?${query}`)).rejects.toMatchObject({ status: 422, code: 'invalid' })
  })
  it('finds the exact customer by tenant id', async () => {
    const tenant = randomUUID()
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Admin filter','saas','managed',$2,false)", [tenant, tenant])
    await pool.query('UPDATE customers SET tenant_id=$2 WHERE id=$1', [ids[1], tenant])
    expect((await call('GET', `/customers?tenant_id=${tenant}&limit=1`)).data.items.map((x: any) => x.id)).toEqual([ids[1]])
  })
  it('requires vendor read before listing customers', async () => {
    await expect(call('GET', '/customers', undefined, [])).rejects.toMatchObject({ status: 403 })
  })
  it('refuses plan-based tenant creation without vendor.tenants.manage (403, nothing written)', async () => {
    const name = `${prefix} forbidden ${randomUUID()}`
    await expect(call('POST', '/customers', { name, admin_name: 'Admin', admin_login: 'admin@example.test' }, ['vendor.read', 'vendor.subscriptions.manage'])).rejects.toMatchObject({ status: 403, code: 'forbidden' })
    expect((await pool.query('SELECT count(*)::int AS n FROM customers WHERE name=$1', [name])).rows[0].n).toBe(0)
    // A first order for a customer that has no tenant provisions one on fulfilment.
    const customer = randomUUID(), quote = randomUUID()
    await pool.query('INSERT INTO customers(id,name) VALUES($1,$2)', [customer, name])
    await pool.query("INSERT INTO commercial_quotes(id,customer_id,payload,digest,expires_at) VALUES($1,$2,'{}','test',now()+interval '1 hour')", [quote, customer])
    await expect(call('POST', '/orders', { quote_id: quote, expected_subscription_revision: 0, idempotency_key: randomUUID() }, ['vendor.read', 'vendor.subscriptions.manage'])).rejects.toMatchObject({ status: 403, code: 'forbidden' })
    expect((await pool.query('SELECT count(*)::int AS n FROM orders WHERE customer_id=$1', [customer])).rows[0].n).toBe(0)
    expect((await pool.query('SELECT count(*)::int AS n FROM subscriptions WHERE customer_id=$1', [customer])).rows[0].n).toBe(0)
  })
  it('makes plan-based tenant (customer) creation idempotent per request id', async () => {
    const manage = ['vendor.tenants.manage', 'vendor.subscriptions.manage']
    const request_id = randomUUID(), name = `${prefix} idem ${request_id}`
    const body = { name, admin_name: 'Admin', admin_login: 'idem@example.test', request_id }
    // Double submit racing on two connections, then a later network replay.
    const [a, b] = await Promise.all([call('POST', '/customers', body, manage), call('POST', '/customers', body, manage)])
    const replay = await call('POST', '/customers', body, manage)
    expect([a.status, b.status].sort()).toEqual([200, 201])
    expect(replay.status).toBe(200)
    expect(new Set([a.data.id, b.data.id, replay.data.id]).size).toBe(1)
    expect((await pool.query('SELECT count(*)::int AS n FROM customers WHERE name=$1', [name])).rows[0].n).toBe(1)
    await expect(call('POST', '/customers', { ...body, admin_login: 'other@example.test' }, manage)).rejects.toMatchObject({ status: 409, code: 'idempotency_conflict' })
    expect((await pool.query('SELECT count(*)::int AS n FROM customers WHERE creation_request_id=$1', [request_id])).rows[0].n).toBe(1)
  })
  it('keeps SQL filtering aligned with receipt-based display states', async () => {
    const label = `states-${randomUUID()}`
    const cases = [
      ['active', false, null, null, false, false, 'activating'],
      ['active', true, null, null, false, false, 'active'],
      ['pending', false, null, null, false, false, 'awaiting_payment'],
      ['pending', true, null, null, false, false, 'activating'],
      ['trialing', true, null, null, false, false, 'active'],
      ['suspended', true, null, null, false, false, 'inactive'],
      ['cancelled', false, null, null, false, false, 'inactive'],
      ['active', true, 'awaiting_payment', 'not_started', false, false, 'awaiting_payment'],
      ['active', true, 'failed', 'not_started', false, false, 'awaiting_payment'],
      ['active', true, 'paid', 'queued', false, false, 'activating'],
      ['active', true, 'not_required', 'applying', false, false, 'activating'],
      ['active', true, 'paid', 'failed', false, false, 'failed'],
      ['active', true, 'paid', 'needs_intervention', false, false, 'failed'],
      ['active', true, 'refund_pending', 'not_started', false, false, 'failed'],
      ['active', true, 'refunded', 'not_started', false, false, 'failed'],
      ['active', true, 'awaiting_payment', 'not_started', true, false, 'active'],
      ['active', true, 'paid', 'applied', false, false, 'active'],
      ['active', true, 'paid', 'failed', false, true, 'setup_required'],
    ] as const
    for (const [state, applied, payment, fulfillment, cancelled, setupRequired, expected] of cases) {
      const customer = randomUUID(), sub = randomUUID(), revision = randomUUID(), quote = randomUUID()
      await pool.query('INSERT INTO customers(id,name,commercial_setup_required) VALUES($1,$2,$3)', [customer, label, setupRequired])
      await pool.query('INSERT INTO subscriptions(id,customer_id,state) VALUES($1,$2,$3)', [sub, customer, state])
      const snapshot = { customer_id: customer, tenant_id: customer, plan_revision_id: randomUUID(), bundle_revision_ids: [], terms_revision_id: null, policy_revision_id: randomUUID(), cadence: { unit: 'month', count: 1 }, term_start: '2026-01-01', term_end: '2027-01-01', period_start: '2026-01-01', period_end: '2026-02-01', included_extra_branches: 0, extra_branch_count: 0, entitlement: { catalog_release_id: randomUUID(), modules: [], features: {}, compiler_version: 'test', digest: 'a'.repeat(64) } }
      await pool.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,$3,$4)', [revision, sub, snapshot, quote])
      if (applied) await pool.query('UPDATE subscriptions SET applied_revision_id=$2,revision=1 WHERE id=$1', [sub, revision])
      if (payment) await pool.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,cancelled,idempotency_key,request_digest,due_now_minor,currency,exponent)
        VALUES($1,$2,$3,'change',$4,$5,$6,$7,$8,$9,'states',100,'SAR',2)`, [randomUUID(), customer, sub, quote, revision, payment, fulfillment, cancelled, randomUUID()])
      const view = await getSubscription(pool, customer)
      expect(setupRequired ? 'setup_required' : subscriptionDisplayState(view)).toBe(expected)
      const filtered = await call('GET', `/customers?q=${label}&state=${expected}`)
      expect(filtered.data.items.find((item: any) => item.id === customer)?.display_state).toBe(expected)
    }
  })
  async function order(state: string = 'awaiting_payment') {
    const customer = randomUUID(), subscription = randomUUID(), revision = randomUUID(), id = randomUUID(), quote = randomUUID()
    await pool.query('INSERT INTO customers(id,name) VALUES($1,$2)', [customer, prefix + ' Order'])
    await pool.query('INSERT INTO subscriptions(id,customer_id) VALUES($1,$2)', [subscription, customer])
    // Not a deployed tenant: only a reserved target, read by the cancellation code.
    await pool.query("INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,'{}',$3)", [revision, subscription, quote])
    await pool.query('UPDATE subscriptions SET target_revision_id=$2,revision=1 WHERE id=$1', [subscription, revision])
    await pool.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent)
      VALUES($1,$2,$3,'new',$4,$5,$6,'not_started',$7,'admin-test',100,'SAR',2)`, [id, customer, subscription, quote, revision, state, randomUUID()])
    return { id, customer, subscription }
  }
  it('cancels an unpaid order through the admin route and releases its target with audit', async () => {
    const f = await order()
    const response = await call('POST', `/orders/${f.id}/cancel`, { reason: 'Customer changed selection' })
    expect(response).toMatchObject({ status: 200, data: { id: f.id } })
    expect((await pool.query('SELECT cancelled FROM orders WHERE id=$1', [f.id])).rows[0]).toEqual({ cancelled: true })
    expect((await pool.query('SELECT target_revision_id,revision FROM subscriptions WHERE id=$1', [f.subscription])).rows[0]).toEqual({ target_revision_id: null, revision: 2 })
    expect((await getSubscription(pool, f.customer)).pending_order).toBeNull()
    expect((await pool.query("SELECT action,reason FROM audit_events WHERE subject=$1 AND action='order.cancelled'", [f.id])).rows).toEqual([{ action: 'order.cancelled', reason: 'Customer changed selection' }])
  })
  it('enforces the cancellation capability and validates the body before any change', async () => {
    const f = await order()
    await expect(call('POST', `/orders/${f.id}/cancel`, { reason: 'Customer changed selection' }, ['vendor.read'])).rejects.toMatchObject({ status: 403 })
    for (const body of [{ reason: '  ' }, { reason: 'Customer changed selection', force: true }])
      await expect(call('POST', `/orders/${f.id}/cancel`, body)).rejects.toMatchObject({ status: 422 })
    expect((await pool.query('SELECT cancelled FROM orders WHERE id=$1', [f.id])).rows[0].cancelled).toBe(false)
  })
  it('refuses renewal cancellation so the unique cycle collection remains authoritative', async () => {
    const f = await order()
    await pool.query("UPDATE orders SET kind='renewal' WHERE id=$1", [f.id])
    await expect(call('POST', `/orders/${f.id}/cancel`, {reason:'Customer changed selection'})).rejects.toMatchObject({status:409,code:'order_not_cancellable'})
    expect((await pool.query('SELECT cancelled FROM orders WHERE id=$1', [f.id])).rows[0].cancelled).toBe(false)
    expect((await pool.query('SELECT target_revision_id,revision FROM subscriptions WHERE id=$1', [f.subscription])).rows[0]).toEqual({target_revision_id:expect.any(String),revision:1})
  })
  it.each(['paid', 'failed'])('keeps a %s order authoritative', async state => {
    const f = await order(state)
    await expect(call('POST', `/orders/${f.id}/cancel`, { reason: 'Customer changed selection' })).rejects.toMatchObject({ status: 409, code: 'order_not_cancellable' })
    expect((await pool.query('SELECT cancelled FROM orders WHERE id=$1', [f.id])).rows[0].cancelled).toBe(false)
  })
  it('requires reconciliation for an unknown provider attempt instead of cancelling locally', async () => {
    const f = await order(), invoice = randomUUID()
    await pool.query(`INSERT INTO invoices(id,customer_id,subscription_id,order_id,kind,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end)
      VALUES($1,$2,$3,$4,'initial','SAR',2,100,0,100,'2026-01-01','2026-02-01')`, [invoice, f.customer, f.subscription, f.id])
    await pool.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,amount_minor,currency,exponent,status)
      VALUES($1,$2,$3,'simulator','simulator',100,'SAR',2,'unknown')`, [randomUUID(), f.id, invoice])
    await expect(call('POST', `/orders/${f.id}/cancel`, { reason: 'Customer changed selection' }, caps, { adapter: new SimulatorAdapter(), allowedOrigin: 'http://nasq.test' })).rejects.toMatchObject({ status: 409, code: 'payment_reconciliation_required' })
    expect((await pool.query('SELECT cancelled FROM orders WHERE id=$1', [f.id])).rows[0].cancelled).toBe(false)
    expect((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE subject=$1 AND action='order.cancelled'", [f.id])).rows[0].n).toBe(0)
  })
})
