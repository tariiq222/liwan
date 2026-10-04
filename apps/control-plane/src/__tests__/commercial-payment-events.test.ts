import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { migrate, transaction } from '../db.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'
import { createPaymentAttempt, handleProviderEvent, markReturned, reconcileUnknownAttempts } from '../commercial/payments.js'
import { recordFulfillmentFailure, processRefundOutbox } from '../commercial/settlements.js'
import { cancelOrder } from '../commercial/orders.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
if (url && new URL(url).pathname !== '/nasq_control_scratch_payfinal') throw new Error('payment tests require own scratch DB')
const suite = url ? describe : describe.skip
suite('simulated payment settlement on live PostgreSQL', () => {
  const pool = new Pool({connectionString:url,max:8})
  beforeAll(async () => { await migrate(pool) })
  beforeEach(async () => { await pool.query('TRUNCATE customers CASCADE'); await pool.query('TRUNCATE commercial_outbox') })
  afterAll(async () => { await pool.end() })
  async function fixture(adapter = new SimulatorAdapter()) {
    const customer_id=randomUUID(),sub=randomUUID(),revision=randomUUID(),order_id=randomUUID(),invoice=randomUUID()
    await transaction(pool, async c => {
      await c.query('INSERT INTO customers(id,name) VALUES($1,$2)',[customer_id,'Payment test'])
      await c.query('INSERT INTO subscriptions(id,customer_id) VALUES($1,$2)',[sub,customer_id])
      await c.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,$3,$4)',[revision,sub,'{}',randomUUID()])
      await c.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent)
        VALUES($1,$2,$3,'new',$4,$5,'awaiting_payment','not_started',$6,'fixture',11500,'SAR',2)`,[order_id,customer_id,sub,randomUUID(),revision,randomUUID()])
      await c.query(`INSERT INTO invoices(id,customer_id,subscription_id,order_id,kind,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end,due_at)
        VALUES($1,$2,$3,$4,'initial','SAR',2,10000,1500,11500,'2026-01-01','2026-02-01',now())`,[invoice,customer_id,sub,order_id])
    })
    const input = {order_id,customer_id,adapter,allowedOrigin:'https://nasq.test',return_path:'/subscription'}
    return {input,adapter,order_id,invoice}
  }
  const deliver = (adapter: SimulatorAdapter, rawBody: Uint8Array) => handleProviderEvent(pool,{provider:'simulator',adapter,rawBody,headers:{}})
  async function state(order: string) { return (await pool.query('SELECT * FROM orders WHERE id=$1',[order])).rows[0] }
  async function counts(order: string) {
    return (await pool.query(`SELECT (SELECT count(*)::int FROM payment_attempts WHERE order_id=$1 AND status='succeeded') AS payments,
      (SELECT count(*)::int FROM commercial_outbox WHERE aggregate_id=$1::uuid::text AND kind='fulfillment.enqueue') AS outbox`,[order])).rows[0]
  }
  it('deduplicates sequential succeeded callbacks and uses issued invoice money',async () => {
    const f=await fixture(),a=await createPaymentAttempt(pool,f.input)
    expect(a.amount.minor).toBe(11500)
    f.adapter.settle(a.provider_ref)
    const [one,two]=f.adapter.duplicateBodies(a.provider_ref)
    expect(await deliver(f.adapter,one)).toEqual({status:200,outcome:'accepted'})
    expect(await deliver(f.adapter,two)).toEqual({status:200,outcome:'duplicate'})
    expect(await counts(f.order_id)).toEqual({payments:1,outbox:1})
    expect((await pool.query('SELECT status,paid_at FROM invoices WHERE id=$1',[f.invoice])).rows[0]).toMatchObject({status:'paid',paid_at:expect.any(Date)})
  })
  it('serializes concurrent duplicate callbacks and attempt creation',async () => {
    const f=await fixture(),create=vi.spyOn(f.adapter,'createAttempt')
    const attempts=await Promise.all([createPaymentAttempt(pool,f.input),createPaymentAttempt(pool,f.input)])
    expect(attempts[0].id).toBe(attempts[1].id);expect(create).toHaveBeenCalledTimes(1)
    const a=await createPaymentAttempt(pool,f.input)
    f.adapter.settle(a.provider_ref)
    const body=f.adapter.webhookBody(a.provider_ref)
    const r=await Promise.all([deliver(f.adapter,body),deliver(f.adapter,body)])
    expect(r.map(x=>x.outcome).sort()).toEqual(['accepted','duplicate'])
    expect(await counts(f.order_id)).toEqual({payments:1,outbox:1})
  })
  it.each(['secret','merchant','amount'] as const)('rejects bad %s without settlement',async fault => {
    const f=await fixture(),a=await createPaymentAttempt(pool,f.input)
    f.adapter.settle(a.provider_ref)
    const overrides=fault==='amount'?{amount:{minor:1,currency:'SAR',exponent:2}}:fault==='merchant'?{merchant:'other'}:{secret:'wrong'}
    expect(await deliver(f.adapter,f.adapter.webhookBody(a.provider_ref,overrides))).toEqual({status:fault==='amount'?200:401,outcome:'rejected'})
    expect((await state(f.order_id)).payment_state).toBe('awaiting_payment')
    expect(await counts(f.order_id)).toEqual({payments:0,outbox:0})
  })
  it('stale pending cannot regress paid',async () => {
    const f=await fixture(),a=await createPaymentAttempt(pool,f.input)
    f.adapter.settle(a.provider_ref)
    const [paid,pending]=f.adapter.outOfOrderBodies(a.provider_ref)
    await deliver(f.adapter,paid);await deliver(f.adapter,pending)
    expect((await state(f.order_id)).payment_state).toBe('paid')
    expect(await counts(f.order_id)).toEqual({payments:1,outbox:1})
  })
  it('browser return alone is not payment and return paths stay same-origin',async () => {
    const f=await fixture();await createPaymentAttempt(pool,f.input)
    expect((await markReturned(pool,{order_id:f.order_id,adapter:f.adapter})).status).toBe('redirected')
    expect((await state(f.order_id)).payment_state).toBe('awaiting_payment')
    await expect(createPaymentAttempt(pool,{...f.input,return_path:'//evil.test'})).rejects.toMatchObject({status:422})
  })
  it('paid after cancellation requires refund rather than fulfillment',async () => {
    const f=await fixture(),a=await createPaymentAttempt(pool,f.input)
    await pool.query('UPDATE orders SET cancelled=true WHERE id=$1',[f.order_id]);f.adapter.settle(a.provider_ref)
    await deliver(f.adapter,f.adapter.webhookBody(a.provider_ref))
    expect((await state(f.order_id)).payment_state).toBe('refund_pending')
    expect((await pool.query('SELECT kind FROM commercial_outbox WHERE aggregate_id=$1',[f.order_id])).rows).toEqual([{kind:'reconcile.refund'}])
  })
  it('cancels an awaiting order, releases its target, and records provider cancellation', async () => {
    const f=await fixture(),a=await createPaymentAttempt(pool,f.input)
    const order=await state(f.order_id)
    await pool.query('UPDATE subscriptions SET target_revision_id=$2,revision=revision+1 WHERE id=$1',[order.subscription_id,order.target_revision_id])
    const principal:any={actor_id:'7',kind:'customer',customer_id:f.input.customer_id,tenant_id:null,capabilities:['subscription.manage']}
    const cancel=vi.spyOn(f.adapter,'cancelAttempt')
    await expect(cancelOrder(pool,{order_id:f.order_id,principal:{...principal,customer_id:randomUUID()},reason:'Cancel purchase',adapter:f.adapter})).rejects.toMatchObject({status:404})
    await cancelOrder(pool,{order_id:f.order_id,principal,reason:'Cancel purchase',adapter:f.adapter})
    expect(cancel).toHaveBeenCalledWith(a.provider_ref)
    expect(await state(f.order_id)).toMatchObject({cancelled:true,fulfillment_state:'not_started'})
    expect((await pool.query('SELECT target_revision_id,revision FROM subscriptions WHERE id=$1',[order.subscription_id])).rows[0]).toEqual({target_revision_id:null,revision:2})
    expect((await pool.query('SELECT status FROM payment_attempts WHERE id=$1',[a.id])).rows[0].status).toBe('canceled')
    f.adapter.settle(a.provider_ref)
    await deliver(f.adapter,f.adapter.webhookBody(a.provider_ref))
    expect((await state(f.order_id)).payment_state).toBe('refund_pending')
    const refund=vi.spyOn(f.adapter,'refund')
    await Promise.all([processRefundOutbox(pool,f.adapter),processRefundOutbox(pool,f.adapter)])
    await processRefundOutbox(pool,f.adapter)
    expect(refund).not.toHaveBeenCalled()
    expect((await pool.query('SELECT kind,status FROM invoice_adjustments WHERE invoice_id=$1',[f.invoice])).rows).toEqual([{kind:'credit_note',status:'pending'}])
    expect((await pool.query("SELECT status FROM commercial_outbox WHERE aggregate_id=$1 AND kind='reconcile.refund'",[f.order_id])).rows).toEqual([{status:'done'}])
  })
  it.each(['paid','queued','applying'] as const)('refuses cancellation after %s', async stage => {
    const f=await fixture()
    await pool.query('UPDATE orders SET payment_state=$2,fulfillment_state=$3 WHERE id=$1',[f.order_id,stage==='paid'?'paid':'awaiting_payment',stage==='paid'?'not_started':stage])
    const principal:any={actor_id:'7',kind:'vendor',customer_id:null,tenant_id:null,capabilities:['vendor.subscriptions.manage']}
    await expect(cancelOrder(pool,{order_id:f.order_id,principal,reason:'Cancel purchase',adapter:f.adapter})).rejects.toMatchObject({status:409})
  })
  it('refunded after applied preserves entitlement and emits manual intervention audit/outbox',async()=>{
    const f=await fixture(),a=await createPaymentAttempt(pool,f.input)
    const paid=f.adapter.settle(a.provider_ref);await deliver(f.adapter,f.adapter.webhookBody(a.provider_ref))
    const order=await state(f.order_id)
    await pool.query("UPDATE orders SET fulfillment_state='applied' WHERE id=$1",[f.order_id])
    await pool.query("UPDATE subscriptions SET applied_revision_id=$2,state='active',revision=revision+1 WHERE id=$1",[order.subscription_id,order.target_revision_id])
    await f.adapter.refund(paid.payment_id!)
    await deliver(f.adapter,f.adapter.webhookBody(a.provider_ref))
    expect(await state(f.order_id)).toMatchObject({payment_state:'refunded',fulfillment_state:'applied'})
    expect((await pool.query('SELECT applied_revision_id FROM subscriptions WHERE id=$1',[order.subscription_id])).rows[0].applied_revision_id).toBe(order.target_revision_id)
    expect((await pool.query("SELECT count(*)::int AS n FROM commercial_outbox WHERE aggregate_id=$1 AND kind='payment.intervention'",[f.order_id])).rows[0].n).toBe(1)
    expect((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE subject=$1 AND action='payment.intervention'",[f.order_id])).rows[0].n).toBe(1)
  })
  it.each(['merchant','mode'] as const)('rejects wrong %s returned by authoritative lookup',async fault=>{
    const f=await fixture(),a=await createPaymentAttempt(pool,f.input)
    const event=f.adapter.settle(a.provider_ref)
    vi.spyOn(f.adapter,'lookupAttempt').mockResolvedValue({...event,...(fault==='merchant'?{merchant_account:'other'}:{live:true})})
    expect(await deliver(f.adapter,f.adapter.webhookBody(a.provider_ref))).toEqual({status:200,outcome:'rejected'})
    await expect(markReturned(pool,{order_id:f.order_id,adapter:f.adapter})).rejects.toMatchObject({status:409})
    expect((await state(f.order_id)).payment_state).toBe('awaiting_payment')
  })
  it('unknown creation looks up before another attempt and can reconcile later',async () => {
    const adapter=new SimulatorAdapter({defaultOutcome:'timeout'}),f=await fixture(adapter)
    await expect(createPaymentAttempt(pool,f.input)).rejects.toMatchObject({status:503})
    const lookup=vi.spyOn(adapter,'lookupByAttemptId'),create=vi.spyOn(adapter,'createAttempt')
    const a=await createPaymentAttempt(pool,f.input)
    expect(lookup).toHaveBeenCalledTimes(1);expect(create).not.toHaveBeenCalled()
    const event=await adapter.lookupAttempt(a.provider_ref)
    const body=adapter.webhookBody(a.provider_ref,{status:'succeeded',eventId:randomUUID()})
    // Authoritative simulated provider is still pending, so callback alone cannot pay.
    expect(event.status).toBe('pending');await deliver(adapter,body)
    expect((await state(f.order_id)).payment_state).toBe('awaiting_payment')
    expect(await reconcileUnknownAttempts(pool,adapter)).toContainEqual({id:a.id,outcome:'ignored'})
  })
  it('failed fulfillment records a pending credit once, never deletes invoice',async () => {
    const f=await fixture(),a=await createPaymentAttempt(pool,f.input)
    f.adapter.settle(a.provider_ref);await deliver(f.adapter,f.adapter.webhookBody(a.provider_ref))
    await transaction(pool,async c=>{
      expect(await recordFulfillmentFailure(c,{order_id:f.order_id,reason:'Fulfillment failed',actor:'test'})).toHaveLength(1)
      expect(await recordFulfillmentFailure(c,{order_id:f.order_id,reason:'Fulfillment retry failed',actor:'test'})).toHaveLength(0)
    })
    expect((await pool.query('SELECT status FROM invoices WHERE id=$1',[f.invoice])).rows[0].status).toBe('credit_pending')
    expect((await pool.query('SELECT kind,status,amount_minor FROM invoice_adjustments WHERE invoice_id=$1',[f.invoice])).rows).toEqual([{kind:'credit_note',status:'pending',amount_minor:'11500'}])
  })
})
