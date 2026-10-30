import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { migrate, transaction } from '../db.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'
import { MoyasarAdapter } from '../commercial/moyasar-adapter.js'
import { routesB } from '../commercial/routes-b.js'
import type { CommercialInput } from '../commercial/http.js'
import type { PaymentRuntime } from '../commercial/customer-http.js'
import { fixedReturnOrigin } from '../commercial/return-origin.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
if (url) {
  const parsed = new URL(url)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || parsed.pathname !== '/liwan_control_scratch_payfinal') throw new Error('simulator settlement tests require own loopback liwan_control_scratch_payfinal DB')
}
function settle(pool: Pool, runtime: PaymentRuntime | undefined, id: string, body: unknown = {outcome:'succeeded'}, caps: CommercialInput['capabilities'] = ['vendor.billing.manage']) {
  const pathname = `/v1/commercial/payment-simulator/${id}/settle`
  return routesB(pool, {method:'POST',pathname,raw:JSON.stringify(body),issuer:'test-vendor',actor:7,capabilities:caps,stepUpFresh:true}, new URL(pathname,'http://localhost'), runtime)
}
afterEach(() => vi.unstubAllEnvs())

describe('simulator settlement fail-closed guards', () => {
  const pool = {} as Pool
  it('returns 404 in production even with an existing simulator instance', async () => {
    const adapter = new SimulatorAdapter({env:{NODE_ENV:'test'}})
    vi.stubEnv('NODE_ENV','production')
    await expect(settle(pool,{adapter,returnOrigin: fixedReturnOrigin('https://liwan.test')},randomUUID())).rejects.toMatchObject({status:404,code:'not_found'})
  })
  it('returns 404 for Moyasar and absent adapters without touching the database', async () => {
    vi.stubEnv('NODE_ENV','test')
    const adapter = Object.create(MoyasarAdapter.prototype) as MoyasarAdapter
    for (const runtime of [{adapter,returnOrigin: fixedReturnOrigin('https://liwan.test')},{adapter:null,returnOrigin:null},undefined]) {
      await expect(settle(pool,runtime,randomUUID())).rejects.toMatchObject({status:404,code:'not_found'})
    }
  })
  it('requires vendor.billing.manage and validates the explicit outcome before lookup', async () => {
    const runtime = {adapter:new SimulatorAdapter({env:{NODE_ENV:'test'}}),returnOrigin: fixedReturnOrigin('https://liwan.test')}
    await expect(settle(pool,runtime,randomUUID(),{outcome:'succeeded'},['vendor.read'])).rejects.toMatchObject({status:403})
    for (const body of [{outcome:'pending'},{outcome:'succeeded',provider_ref:'injected'},{}]) {
      await expect(settle(pool,runtime,randomUUID(),body)).rejects.toMatchObject({status:422})
    }
  })
})

const suite = url ? describe : describe.skip
suite('vendor simulator settlement on live PostgreSQL', () => {
  const pool = new Pool({connectionString:url,max:8})
  beforeAll(async () => { await migrate(pool) })
  beforeEach(async () => { vi.stubEnv('NODE_ENV','test'); await pool.query('TRUNCATE customers CASCADE'); await pool.query('TRUNCATE commercial_outbox') })
  afterAll(async () => { await pool.end() })
  async function fixture() {
    const customer_id=randomUUID(), subscription_id=randomUUID(),revision=randomUUID(),order_id=randomUUID(),invoice_id=randomUUID()
    await transaction(pool, async c => {
      await c.query('INSERT INTO customers(id,name) VALUES($1,$2)',[customer_id,'Simulator settlement test'])
      await c.query('INSERT INTO subscriptions(id,customer_id) VALUES($1,$2)',[subscription_id,customer_id])
      await c.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,$3,$4)',[revision,subscription_id,'{}',randomUUID()])
      await c.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent)
        VALUES($1,$2,$3,'new',$4,$5,'awaiting_payment','not_started',$6,'fixture',11500,'SAR',2)`,[order_id,customer_id,subscription_id,randomUUID(),revision,randomUUID()])
      await c.query(`INSERT INTO invoices(id,customer_id,subscription_id,order_id,kind,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end,due_at)
        VALUES($1,$2,$3,$4,'initial','SAR',2,10000,1500,11500,'2026-01-01','2026-02-01',now())`,[invoice_id,customer_id,subscription_id,order_id])
    })
    const runtime = {adapter:new SimulatorAdapter(),returnOrigin: fixedReturnOrigin('https://liwan.test')}
    const pathname = `/v1/commercial/orders/${order_id}/payment-attempts`
    const result = await routesB(pool,{method:'POST',pathname,raw:JSON.stringify({}),issuer:'test-vendor',actor:7,capabilities:['vendor.billing.manage'],stepUpFresh:true},new URL(pathname,'http://localhost'),runtime)
    const attempt = result!.data as {id:string;provider_ref:string}
    return {runtime,attempt,order_id,invoice_id}
  }
  async function outboxCount(id: string) {
    return (await pool.query("SELECT count(*)::int AS n FROM commercial_outbox WHERE aggregate_id=$1 AND kind='fulfillment.enqueue'",[id])).rows[0].n
  }
  it('settles through the same API adapter, confirms payment and deduplicates repeated settlement', async () => {
    const f = await fixture()
    const verify = vi.spyOn(f.runtime.adapter,'verifyEvent'), lookup = vi.spyOn(f.runtime.adapter,'lookupAttempt')
    expect(await settle(pool,f.runtime,f.attempt.id)).toEqual({status:200,data:{status:200,outcome:'accepted',simulated:true}})
    expect(verify).toHaveBeenCalledTimes(1); expect(lookup).toHaveBeenCalledWith(f.attempt.provider_ref)
    expect((await pool.query('SELECT payment_state FROM orders WHERE id=$1',[f.order_id])).rows[0].payment_state).toBe('paid')
    expect((await pool.query('SELECT status,paid_at FROM invoices WHERE id=$1',[f.invoice_id])).rows[0]).toMatchObject({status:'paid',paid_at:expect.any(Date)})
    expect(await outboxCount(f.order_id)).toBe(1)
    expect(await settle(pool,f.runtime,f.attempt.id)).toEqual({status:200,data:{status:200,outcome:'duplicate',simulated:true}})
    expect(await outboxCount(f.order_id)).toBe(1)
    expect((await pool.query('SELECT count(*)::int AS n FROM payment_events WHERE attempt_id=$1',[f.attempt.id])).rows[0].n).toBe(1)
  })
  it.each(['failed','canceled'] as const)('settles %s without marking the invoice paid or enqueueing fulfillment', async outcome => {
    const f = await fixture()
    expect(await settle(pool,f.runtime,f.attempt.id,{outcome})).toEqual({status:200,data:{status:200,outcome:'accepted',simulated:true}})
    expect((await f.runtime.adapter.lookupAttempt(f.attempt.provider_ref)).status).toBe(outcome)
    expect((await pool.query('SELECT status FROM invoices WHERE id=$1',[f.invoice_id])).rows[0].status).toBe('issued')
    expect(await outboxCount(f.order_id)).toBe(0)
  })
  it('recovers an attempt the restarted API no longer remembers', async () => {
    const f = await fixture()
    const restarted = {...f.runtime,adapter:new SimulatorAdapter()}
    expect(await settle(pool,restarted,f.attempt.id)).toEqual({status:200,data:{status:200,outcome:'accepted',simulated:true}})
    expect((await pool.query('SELECT payment_state FROM orders WHERE id=$1',[f.order_id])).rows[0].payment_state).toBe('paid')
    expect(await outboxCount(f.order_id)).toBe(1)
  })
  it('fails closed for missing and non-simulator attempts', async () => {
    const f = await fixture()
    await expect(settle(pool,f.runtime,randomUUID())).rejects.toMatchObject({status:404})
    await pool.query("UPDATE payment_attempts SET provider='moyasar',mode='test' WHERE id=$1",[f.attempt.id])
    await expect(settle(pool,f.runtime,f.attempt.id)).rejects.toMatchObject({status:404})
    expect(await outboxCount(f.order_id)).toBe(0)
  })
})

describe('simulator settlement after an API restart', () => {
  const attemptRow = { id: randomUUID(), order_id: randomUUID(), provider: 'simulator', mode: 'simulator', provider_ref: 'sim_inv_0a1b2c3d_1', amount_minor: 11500, currency: 'SAR', exponent: 2 }
  it('re-adopts the attempt row instead of answering 404, then settles it', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    const adapter = new SimulatorAdapter({ env: { NODE_ENV: 'test' } })
    const pool = { query: async () => ({ rows: [attemptRow] }) } as unknown as Pool
    expect(adapter.adopt(attemptRow)).toBe(true)
    expect((await adapter.lookupByAttemptId(attemptRow.id))?.provider_ref).toBe(attemptRow.provider_ref)
    const fresh = new SimulatorAdapter({ env: { NODE_ENV: 'test' } })
    const runtime = { adapter: fresh, returnOrigin: fixedReturnOrigin('https://liwan.test') }
    // The settle route re-adopts, then fails only later at the webhook handler (no database in this pool double).
    await expect(settle(pool, runtime, attemptRow.id)).rejects.not.toMatchObject({ status: 404 })
  })
  it('refuses a ref the simulator never issued', () => {
    const adapter = new SimulatorAdapter({ env: { NODE_ENV: 'test' } })
    expect(adapter.adopt({ ...attemptRow, provider_ref: 'inv_live_123' })).toBe(false)
  })
})
