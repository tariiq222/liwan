import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { migrate, transaction } from '../db.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'
import { PaymentError } from '../commercial/payment-adapter.js'
import { createPaymentAttempt, handleProviderEvent } from '../commercial/payments.js'
import { fixedReturnOrigin } from '../commercial/return-origin.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
if (url && !/^\/liwan_control_scratch_[a-z0-9]+$/.test(new URL(url).pathname)) throw new Error('scratch control DB required')
const suite = url ? describe : describe.skip

suite('the payment webhook asks the provider outside its transaction (AUDIT-050)', () => {
  // One connection only: a handler that kept its connection while waiting for the provider would starve every other query.
  const pool = new Pool({ connectionString: url, max: 1 })
  beforeAll(async () => { await migrate(pool) })
  beforeEach(async () => { await pool.query('TRUNCATE customers CASCADE'); await pool.query('TRUNCATE commercial_outbox') })
  afterAll(async () => { await pool.end() })

  async function paidAttempt() {
    const adapter = new SimulatorAdapter()
    const customer_id = randomUUID(), sub = randomUUID(), revision = randomUUID(), order_id = randomUUID(), invoice = randomUUID()
    await transaction(pool, async c => {
      await c.query('INSERT INTO customers(id,name,admin_name,admin_login) VALUES($1,$2,$3,$4)', [customer_id, 'Webhook test', 'Manager', 'webhook@example.test'])
      await c.query('INSERT INTO subscriptions(id,customer_id) VALUES($1,$2)', [sub, customer_id])
      await c.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,$3,$4)', [revision, sub, '{}', randomUUID()])
      await c.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent)
        VALUES($1,$2,$3,'new',$4,$5,'awaiting_payment','not_started',$6,'fixture',11500,'SAR',2)`, [order_id, customer_id, sub, randomUUID(), revision, randomUUID()])
      await c.query(`INSERT INTO invoices(id,customer_id,subscription_id,order_id,kind,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end,due_at)
        VALUES($1,$2,$3,$4,'initial','SAR',2,10000,1500,11500,'2026-01-01','2026-02-01',now())`, [invoice, customer_id, sub, order_id])
    })
    const attempt = await createPaymentAttempt(pool, { order_id, customer_id, adapter, returnOrigin: fixedReturnOrigin('https://liwan.test') })
    adapter.settle(attempt.provider_ref)
    return { adapter, order_id, body: adapter.webhookBody(attempt.provider_ref) }
  }
  const deliver = (adapter: SimulatorAdapter, rawBody: Uint8Array) => handleProviderEvent(pool, { provider: 'simulator', adapter, rawBody, headers: {} })
  const recorded = async () => (await pool.query('SELECT outcome,confirmed FROM payment_events')).rows
  const paid = async (order: string) => (await pool.query("SELECT count(*)::int AS n FROM payment_attempts WHERE order_id=$1 AND status='succeeded'", [order])).rows[0].n

  it('holds no database connection while a slow provider answers', async () => {
    const f = await paidAttempt()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const lookup = f.adapter.lookupAttempt.bind(f.adapter)
    vi.spyOn(f.adapter, 'lookupAttempt').mockImplementation(async ref => { await gate; return lookup(ref) })
    const pending = deliver(f.adapter, f.body)
    // The only pooled connection is free while the provider is still thinking.
    await expect(pool.query('SELECT 1 AS one')).resolves.toMatchObject({ rows: [{ one: 1 }] })
    expect(await recorded()).toEqual([])
    release()
    expect(await pending).toEqual({ status: 200, outcome: 'accepted' })
    expect(await paid(f.order_id)).toBe(1)
  })
  it('records nothing when the provider fails, so the redelivery is settled normally', async () => {
    const f = await paidAttempt()
    const lookup = f.adapter.lookupAttempt.bind(f.adapter)
    vi.spyOn(f.adapter, 'lookupAttempt').mockRejectedValueOnce(new PaymentError('provider_error', 'timeout'))
    await expect(deliver(f.adapter, f.body)).rejects.toMatchObject({ code: 'provider_error' })
    expect(await recorded()).toEqual([])
    expect(await paid(f.order_id)).toBe(0)
    vi.spyOn(f.adapter, 'lookupAttempt').mockImplementation(async ref => lookup(ref))
    expect(await deliver(f.adapter, f.body)).toEqual({ status: 200, outcome: 'accepted' })
    expect(await paid(f.order_id)).toBe(1)
  })
  it('settles once when two deliveries of the same event are both waiting on the provider', async () => {
    const f = await paidAttempt()
    const lookup = f.adapter.lookupAttempt.bind(f.adapter)
    vi.spyOn(f.adapter, 'lookupAttempt').mockImplementation(async ref => { await new Promise(resolve => setTimeout(resolve, 80)); return lookup(ref) })
    const results = await Promise.all([deliver(f.adapter, f.body), deliver(f.adapter, f.body)])
    expect(results.map(r => r.outcome).sort()).toEqual(['accepted', 'duplicate'])
    expect(await paid(f.order_id)).toBe(1)
    expect(await recorded()).toEqual([{ outcome: 'accepted', confirmed: true }])
    // Once recorded, a further delivery is answered without asking the provider again.
    const asked = vi.spyOn(f.adapter, 'lookupAttempt')
    asked.mockClear()
    expect(await deliver(f.adapter, f.body)).toEqual({ status: 200, outcome: 'duplicate' })
    expect(asked).not.toHaveBeenCalled()
  })
  it('records a provider answer that contradicts the event as rejected without settling it', async () => {
    const f = await paidAttempt()
    const lookup = f.adapter.lookupAttempt.bind(f.adapter)
    vi.spyOn(f.adapter, 'lookupAttempt').mockImplementation(async ref => ({ ...(await lookup(ref)), amount: { currency: 'SAR', exponent: 2, minor: 1 } }))
    expect(await deliver(f.adapter, f.body)).toEqual({ status: 200, outcome: 'rejected' })
    expect(await recorded()).toEqual([{ outcome: 'rejected', confirmed: false }])
    expect(await paid(f.order_id)).toBe(0)
  })
})
