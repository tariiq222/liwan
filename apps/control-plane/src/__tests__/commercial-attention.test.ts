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
  const id = { overdue: randomUUID(), stalled: randomUUID(), setup: randomUUID(), renewing: randomUUID(), missed: randomUUID(), calm: randomUUID(), failedOp: randomUUID(), recovered: randomUUID() }
  const tenants = { overdue: randomUUID(), failedOp: randomUUID(), recovered: randomUUID() }
  const operationId = randomUUID()

  const get = async (caps: any[]) => {
    const r = await routesB(pool, { method: 'GET', pathname: '/v1/commercial/attention', search: '', raw: '', issuer: 'attention-test', actor: 7, capabilities: caps }, new URL('http://localhost/v1/commercial/attention'))
    return attentionSchema.parse(r!.data)
  }
  const mine = <T extends { name: string }>(items: T[]) => items.filter(i => i.name.startsWith(tag))

  async function tenant(tenantId: string, name: string) {
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,$2,'saas','managed',$3,false)", [tenantId, name, `target-${tenantId}`])
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
    for (const [key, name] of [['overdue', 'overdue'], ['stalled', 'stalled'], ['setup', 'setup'], ['renewing', 'renewing'], ['missed', 'missed'], ['calm', 'calm']] as const)
      await pool.query('INSERT INTO customers(id,name,tenant_id,commercial_setup_required) VALUES($1,$2,$3,$4)', [id[key], `${tag} ${name}`, key === 'overdue' ? tenants.overdue : null, key === 'setup'])
    const overdue = await subscription(id.overdue, 'past_due', null, tenants.overdue)
    await pool.query("INSERT INTO invoices(id,customer_id,subscription_id,kind,status,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end,issued_at,due_at) VALUES($1,$2,$3,'renewal','issued','SAR',2,100,15,115,'2026-01-01','2026-02-01',now() - interval '20 days',now() - interval '12 days')",
      [randomUUID(), id.overdue, overdue.sub])
    await pool.query("INSERT INTO invoices(id,customer_id,subscription_id,kind,status,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end,issued_at,due_at) VALUES($1,$2,$3,'renewal','issued','SAR',2,100,15,115,'2026-02-01','2026-03-01',now() - interval '5 days',now() - interval '2 days')",
      [randomUUID(), id.overdue, overdue.sub])
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
      ['past_due', 'overdue'], ['stalled_activation', 'stalled'], ['operation_failed', 'failed op'], ['setup_required', 'setup'], ['renewal_missed', 'missed'], ['renewal_soon', 'renewing'],
    ])
    const byKind = Object.fromEntries(mine(items).map(i => [i.kind, i]))
    expect(byKind.past_due).toMatchObject({ customer_id: id.overdue, tenant_id: tenants.overdue, operation_id: null })
    expect(byKind.past_due!.invoice_id).not.toBeNull()
    expect(Date.now() - Date.parse(byKind.past_due!.since)).toBeGreaterThan(11 * 86_400_000)
    expect(Date.now() - Date.parse(byKind.past_due!.since)).toBeLessThan(13 * 86_400_000)
    expect(byKind.stalled_activation).toMatchObject({ customer_id: id.stalled, detail: 'applying' })
    expect(byKind.operation_failed).toMatchObject({ operation_id: operationId, tenant_id: tenants.failedOp, customer_id: null, detail: 'upgrade' })
    expect(byKind.setup_required).toMatchObject({ customer_id: id.setup })
  })

  it('hides overdue invoices from callers without billing access', async () => {
    const { items } = await get(['vendor.read'])
    expect(mine(items).map(i => i.kind)).not.toContain('past_due')
    expect(mine(items).every(i => i.invoice_id === null)).toBe(true)
    expect((await get(['vendor.read'])).counts.past_due).toBeNull()
  })

  it('counts server-side and bounds the list, keeping the most urgent kinds', async () => {
    await pool.query("INSERT INTO customers(id,name,commercial_setup_required) SELECT gen_random_uuid(), $1 || ' bulk ' || n, true FROM generate_series(1,25) n", [tag])
    const r = await get(BILLING)
    expect(r.items).toHaveLength(20)
    expect(r.total).toBe(6 + 25)
    expect(r.items.slice(0, 3).map(i => i.kind)).toEqual(['past_due', 'stalled_activation', 'operation_failed'])
    expect(r.counts.past_due).toBe(1)
    expect(r.counts.stalled).toBeGreaterThanOrEqual(1)
    expect(r.counts.renewals).toBeGreaterThanOrEqual(1)
    expect(r.counts.setup_required).toBeGreaterThanOrEqual(1)
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
