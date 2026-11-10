import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { attentionSchema } from '@liwan/commercial-contracts'
import { routesB } from '../commercial/routes-b.js'
import { migrate } from '../db.js'
import { url } from './commercial-helpers.js'

const BILLING = ['vendor.read', 'vendor.billing.manage'] as any[]
const suite = url ? describe : describe.skip
suite('vendor attention list on PostgreSQL', () => {
  // A database of its own: the list is capped, and other suites leave hundreds of customers needing setup in the shared one.
  const dbName = `liwan_control_scratch_attention${randomUUID().slice(0, 8).replace(/-/g, '')}`
  const withDb = (name: string) => { const u = new URL(url!); u.pathname = `/${name}`; return u.toString() }
  let pool: Pool
  let databaseCreated = false
  const tag = `at${randomUUID().slice(0, 8)}`
  const id = { overdue: randomUUID(), rejected: randomUUID(), blocked: randomUUID(), stalled: randomUUID(), setup: randomUUID(), renewing: randomUUID(), missed: randomUUID(), calm: randomUUID(), failedOp: randomUUID(), recovered: randomUUID() }
  const tenants = { overdue: randomUUID(), failedOp: randomUUID(), recovered: randomUUID() }
  const operationId = randomUUID()
  let rejectedFixture: { order: string; attempt: string; invoice: string }
  /** A paid invoice with its paying attempt, and a refund row the worker closed as failed. */
  async function refundFixture(customerId: string, s: { sub: string, rev: string }, row: { error?: string, refunded?: unknown, omitAttempt?: boolean } = {}) {
    const orderId = randomUUID(), attempt = randomUUID(), invoice = randomUUID()
    await pool.query("INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent) VALUES($1,$2,$3,'new',$4,$5,'paid','applied',$6,'d',11500,'SAR',2)", [orderId, customerId, s.sub, randomUUID(), s.rev, randomUUID()])
    await pool.query("INSERT INTO invoices(id,customer_id,subscription_id,order_id,kind,status,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end,due_at) VALUES($1,$2,$3,$4,'initial','paid','SAR',2,10000,1500,11500,'2026-01-01','2026-02-01',now())", [invoice, customerId, s.sub, orderId])
    await pool.query("INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,provider_ref,amount_minor,currency,exponent,status) VALUES($1,$2,$3,'moyasar','live',$4,11500,'SAR',2,'succeeded')", [attempt, orderId, invoice, `moy-${attempt}`])
    await pool.query("INSERT INTO commercial_outbox(id,kind,aggregate_id,dedupe_key,payload,status,processed_at) VALUES($1,'payment.intervention',$2,$3,$4,'failed',now() - interval '1 day')",
      [randomUUID(), orderId, attempt, JSON.stringify({ order_id: orderId, ...(row.omitAttempt ? {} : { attempt_id: attempt }), ...(row.refunded ? { refunded: row.refunded } : {}), error: row.error ?? 'refund_exceeds_payment' })])
    return { order: orderId, attempt, invoice }
  }

  const get = async (caps: any[]) => {
    const r = await routesB(pool, { method: 'GET', pathname: '/v1/commercial/attention', search: '', raw: '', issuer: 'attention-test', actor: 7, capabilities: caps }, new URL('http://localhost/v1/commercial/attention'))
    return attentionSchema.parse(r!.data)
  }
  const mine = <T extends { name: string }>(items: T[]) => items.filter(i => i.name.startsWith(tag))

  async function tenant(tenantId: string, name: string) {
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,$2,'saas','dedicated_managed',$3,false)", [tenantId, name, `target-${tenantId}`])
  }
  async function subscription(customerId: string, state: string, renewal: string | null, tenantId: string | null = null) {
    const sub = randomUUID(), rev = randomUUID()
    await pool.query('INSERT INTO subscriptions(id,customer_id,tenant_id,state,renewal_at) VALUES($1,$2,$3,$4,$5)', [sub, customerId, tenantId, state, renewal])
    await pool.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,$3,$4)', [rev, sub, '{}', randomUUID()])
    return { sub, rev }
  }
  const order = (customerId: string, s: { sub: string, rev: string }, fulfillment: string, ageHours: number) => pool.query(
    "INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent,created_at) VALUES($1,$2,$3,'new',$4,$5,'paid',$6,$7,'d',0,'SAR',2,now() - make_interval(hours => $8::int))",
    [randomUUID(), customerId, s.sub, randomUUID(), s.rev, fulfillment, randomUUID(), ageHours])
  const operation = (tenantId: string, status: string, id = randomUUID(), ageMinutes = 0) => pool.query(
    "INSERT INTO operations(id,tenant_id,actor_uid,issuer,type,status,request_id,reason,payload,payload_digest,created_at,updated_at) VALUES($1,$2,7,'attention-test','upgrade',$3,$4,'fixture','{}','d',now() - make_interval(mins => $5::int),now() - make_interval(mins => $5::int))",
    [id, tenantId, status, randomUUID(), ageMinutes])

  beforeAll(async () => {
    const admin = new Pool({ connectionString: withDb('postgres') })
    try {
      await admin.query(`CREATE DATABASE ${dbName}`)
      databaseCreated = true
    } finally { await admin.end() }
    pool = new Pool({ connectionString: withDb(dbName) })
    await migrate(pool)
    await tenant(tenants.overdue, `${tag} overdue`); await tenant(tenants.failedOp, `${tag} failed op`); await tenant(tenants.recovered, `${tag} recovered`)
    for (const [key, name] of [['overdue', 'overdue'], ['rejected', 'rejected'], ['blocked', 'blocked'], ['stalled', 'stalled'], ['setup', 'setup'], ['renewing', 'renewing'], ['missed', 'missed'], ['calm', 'calm']] as const)
      await pool.query('INSERT INTO customers(id,name,tenant_id,commercial_setup_required) VALUES($1,$2,$3,$4)', [id[key], `${tag} ${name}`, key === 'overdue' ? tenants.overdue : null, key === 'setup'])
    const overdue = await subscription(id.overdue, 'past_due', null, tenants.overdue)
    await pool.query("INSERT INTO invoices(id,customer_id,subscription_id,kind,status,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end,issued_at,due_at) VALUES($1,$2,$3,'renewal','issued','SAR',2,100,15,115,'2026-01-01','2026-02-01',now() - interval '20 days',now() - interval '12 days')",
      [randomUUID(), id.overdue, overdue.sub])
    await pool.query("INSERT INTO invoices(id,customer_id,subscription_id,kind,status,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end,issued_at,due_at) VALUES($1,$2,$3,'renewal','issued','SAR',2,100,15,115,'2026-02-01','2026-03-01',now() - interval '5 days',now() - interval '2 days')",
      [randomUUID(), id.overdue, overdue.sub])
    const rejected = await subscription(id.rejected, 'active', new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10))
    await order(id.rejected, rejected, 'applied', 1)
    rejectedFixture = await refundFixture(id.rejected, rejected)
    const blocked = await subscription(id.blocked, 'past_due', new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10))
    await pool.query("UPDATE subscriptions SET billing_blocked_at=now() - interval '2 days' WHERE id=$1", [blocked.sub])
    await order(id.stalled, await subscription(id.stalled, 'pending', null), 'applying', 48)
    await subscription(id.renewing, 'active', new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10))
    await subscription(id.missed, 'active', new Date(Date.now() - 4 * 86_400_000).toISOString().slice(0, 10))
    const calm = await subscription(id.calm, 'active', new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10))
    await order(id.calm, calm, 'applying', 1)
    await operation(tenants.failedOp, 'failed', operationId)
    await operation(tenants.recovered, 'failed', randomUUID(), 10); await operation(tenants.recovered, 'succeeded', randomUUID(), 5)
  })
  afterAll(async () => {
    await pool?.end()
    if (!databaseCreated) return
    const admin = new Pool({ connectionString: withDb('postgres') })
    try { await admin.query(`DROP DATABASE ${dbName}`) }
    finally { await admin.end() }
  })

  it('lists each kind once per customer, most urgent first, naming the exact record', async () => {
    const { items } = await get(BILLING)
    expect(mine(items).map(i => [i.kind, i.name.slice(tag.length + 1)])).toEqual([
      ['past_due', 'overdue'], ['refund_rejected', 'rejected'], ['billing_blocked', 'blocked'], ['stalled_activation', 'stalled'], ['operation_failed', 'failed op'], ['setup_required', 'setup'], ['renewal_missed', 'missed'], ['renewal_soon', 'renewing'],
    ])
    const byKind = Object.fromEntries(mine(items).map(i => [i.kind, i]))
    expect(byKind.past_due).toMatchObject({ customer_id: id.overdue, tenant_id: tenants.overdue, operation_id: null })
    expect(byKind.past_due!.invoice_id).not.toBeNull()
    expect(Date.now() - Date.parse(byKind.past_due!.since)).toBeGreaterThan(11 * 86_400_000)
    expect(Date.now() - Date.parse(byKind.past_due!.since)).toBeLessThan(13 * 86_400_000)
    expect(byKind.refund_rejected).toMatchObject({ customer_id: id.rejected, invoice_id: rejectedFixture.invoice, detail: 'refund_exceeds_payment' })
    expect(byKind.billing_blocked).toMatchObject({ customer_id: id.blocked, invoice_id: null, detail: null })
    expect(Date.now() - Date.parse(byKind.billing_blocked!.since)).toBeGreaterThan(1.9 * 86_400_000)
    expect(byKind.stalled_activation).toMatchObject({ customer_id: id.stalled, detail: 'applying' })
    expect(byKind.operation_failed).toMatchObject({ operation_id: operationId, tenant_id: tenants.failedOp, customer_id: null, detail: 'upgrade' })
    expect(byKind.setup_required).toMatchObject({ customer_id: id.setup })
  })

  it('hides overdue invoices from callers without billing access', async () => {
    const { items } = await get(['vendor.read'])
    expect(mine(items).map(i => i.kind)).not.toContain('past_due')
    expect(mine(items).map(i => i.kind)).toContain('billing_blocked')
    expect(mine(items).map(i => i.kind)).not.toContain('refund_rejected')
    expect(mine(items).every(i => i.invoice_id === null)).toBe(true)
    expect((await get(['vendor.read'])).counts.past_due).toBeNull()
  })

  it('counts server-side and bounds the list, keeping the most urgent kinds', async () => {
    await pool.query("INSERT INTO customers(id,name,commercial_setup_required) SELECT gen_random_uuid(), $1 || ' bulk ' || n, true FROM generate_series(1,25) n", [tag])
    const r = await get(BILLING)
    expect(r.items).toHaveLength(20)
    expect(r.total).toBe(8 + 25)
    expect(r.items.slice(0, 5).map(i => i.kind)).toEqual(['past_due', 'refund_rejected', 'billing_blocked', 'stalled_activation', 'operation_failed'])
    expect(r.counts.past_due).toBe(1)
    expect(r.counts.stalled).toBeGreaterThanOrEqual(1)
    expect(r.counts.renewals).toBeGreaterThanOrEqual(1)
    expect(r.counts.setup_required).toBeGreaterThanOrEqual(1)
  })

  describe('a rejected refund and the credit that covers it', () => {
    const listed = async (customerId: string) => (await get(BILLING)).items.some(i => i.kind === 'refund_rejected' && i.customer_id === customerId)
    const credit = (fixture: { invoice: string }, customerId: string, reason: string, status: string, minor = 5000, origin = 'vendor') => pool.query(
      `INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by,origin)
       VALUES($1,$2,$3,'credit_note',$4,$5,'SAR',2,$6,'t',$7) RETURNING id`, [randomUUID(), fixture.invoice, customerId, reason, minor, status, origin])
    const rejectedCustomer = async () => {
      const customer = randomUUID()
      await pool.query('INSERT INTO customers(id,name) VALUES($1,$2)', [customer, `${tag} rejected-extra`])
      const s = await subscription(customer, 'active', new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10))
      return { customer, s }
    }

    it('is shown without credit, cleared by any non-void credit of the invoice, and shown again when that credit is voided', async () => {
      expect(await listed(id.rejected)).toBe(true)
      // A duplicate-charge note is another payment's money and covers nothing.
      await credit(rejectedFixture, id.rejected, 'duplicate payment — manual review (attempt x)', 'pending', 11500, 'system')
      expect(await listed(id.rejected)).toBe(true)
      const vendor = (await credit(rejectedFixture, id.rejected, 'Customer asked for the money back', 'pending', 11500)).rows[0].id
      expect(await listed(id.rejected)).toBe(false)
      await pool.query("UPDATE invoice_adjustments SET status='void' WHERE id=$1", [vendor])
      expect(await listed(id.rejected)).toBe(true)
    })
    it('never shows a rejected event whose refund the vendor credit already covered', async () => {
      const { customer, s } = await rejectedCustomer()
      const fixture = await refundFixture(customer, s, { error: 'refund_amount_missing' })
      await pool.query("DELETE FROM commercial_outbox WHERE aggregate_id=$1", [fixture.order])
      await credit(fixture, customer, 'Customer asked for the money back', 'applied', 11500)
      await pool.query("INSERT INTO commercial_outbox(id,kind,aggregate_id,dedupe_key,payload,status,processed_at) VALUES($1,'payment.intervention',$2,'k',$3,'failed',now())",
        [randomUUID(), fixture.order, JSON.stringify({ order_id: fixture.order, attempt_id: fixture.attempt, error: 'refund_amount_missing' })])
      expect(await listed(customer)).toBe(false)
    })
    it('compares a known refunded figure with the credit and clears on a later processed event', async () => {
      const { customer, s } = await rejectedCustomer()
      const fixture = await refundFixture(customer, s, { error: 'refund_currency_mismatch', refunded: { currency: 'SAR', exponent: 2, minor: 8000 } })
      expect(await listed(customer)).toBe(true)
      await credit(fixture, customer, 'Part of it back', 'pending', 3000)
      expect(await listed(customer)).toBe(true) // 3000 does not cover 8000
      await credit(fixture, customer, 'The rest', 'pending', 5000)
      expect(await listed(customer)).toBe(false)
      const other = await rejectedCustomer()
      const second = await refundFixture(other.customer, other.s, { error: 'refund_amount_missing' })
      expect(await listed(other.customer)).toBe(true)
      await pool.query("INSERT INTO commercial_outbox(id,kind,aggregate_id,dedupe_key,payload,status,processed_at) VALUES($1,'payment.intervention',$2,'later',$3,'done',now())",
        [randomUUID(), second.order, JSON.stringify({ order_id: second.order, attempt_id: second.attempt, refunded: { currency: 'SAR', exponent: 2, minor: 5000 } })])
      expect(await listed(other.customer)).toBe(false)
    })
    it('keeps a rejected row that names no attempt', async () => {
      const { customer, s } = await rejectedCustomer()
      const fixture = await refundFixture(customer, s, { error: 'attempt_id_missing', omitAttempt: true })
      await credit(fixture, customer, 'Customer asked for the money back', 'applied', 11500)
      expect(await listed(customer)).toBe(true)
    })
  })

  it('anchors renewals to the business day, whatever the session time zone', async () => {
    const day = (await pool.query("SELECT to_char((now() AT TIME ZONE 'Asia/Riyadh')::date + 3,'YYYY-MM-DD') AS d")).rows[0].d
    const customer = randomUUID()
    await pool.query("DELETE FROM customers WHERE name LIKE $1", [`${tag} bulk %`]) // the list is capped: make room below the setup rank
    await pool.query('INSERT INTO customers(id,name) VALUES($1,$2)', [customer, `${tag} zone`])
    await subscription(customer, 'active', day)
    for (const zone of ['UTC', 'Pacific/Kiritimati', 'America/Los_Angeles']) {
      const client = await pool.connect()
      try {
        await client.query(`SET TIME ZONE '${zone}'`)
        const r = await routesB(client as unknown as Pool, { method: 'GET', pathname: '/v1/commercial/attention', search: '', raw: '', issuer: 'attention-test', actor: 7, capabilities: BILLING }, new URL('http://localhost/v1/commercial/attention'))
        const found = attentionSchema.parse(r!.data).items.find(i => i.name === `${tag} zone`)
        // Midnight of that Riyadh day is 21:00 UTC of the day before.
        expect(Date.parse(found!.since)).toBe(Date.parse(`${day}T00:00:00+03:00`))
      } finally { client.release() }
    }
  })
})
