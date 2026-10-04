import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { setup, client, money, monthly } from './commercial-helpers.js'
import { acceptQuote } from '../commercial/orders.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'
import { generateRenewals, applyDunning, trialEndsAt } from '../commercial/renewals.js'
import { markReturned } from '../commercial/payments.js'

const url=process.env.CONTROL_TEST_DATABASE_URL
if(url && new URL(url).pathname!=='/nasq_control_scratch_payfinal') throw new Error('renewal tests require own scratch DB')
const suite=url?describe:describe.skip
suite('live PostgreSQL pinned subscription renewals',()=>{
  const pool=new Pool({connectionString:url,max:8}),api=client(pool)
  const vendor:any={actor_id:'7',kind:'vendor',customer_id:null,tenant_id:null,capabilities:['vendor.subscriptions.manage']}
  const now=new Date('2026-10-02T08:00:00Z')
  let suspend:any,keep:any
  async function plan(auto_suspend:boolean,price=10000){
    const c=await api('POST','/plans',{name:`Renewal ${randomUUID()}`,audience:{kind:'public'},term_months:12,currency:'SAR',prices:[{cadence:monthly,amount:money(price)}],platform_limits:{},included_bundle_revision_ids:[],optional_bundle_revision_ids:[],included_extra_branches:1,extra_branch_prices:[{cadence:monthly,amount:money(5000)}],extra_branches_limit:null,policy_revision_id:'6f1c3d8e-0000-4000-8000-000000000001',trial_days:0,grace_days:2,auto_suspend,auto_renew_allowed:true})
    expect(c.status).toBe(201)
    const v=await api('POST',`/plans/${c.body.id}/validate`,{edit_revision:1,reason:'Renewal acceptance'})
    const p=await api('POST',`/plans/${c.body.id}/publish`,{edit_revision:v.body.edit_revision,reason:'Renewal acceptance'})
    expect(p.status).toBe(200);return p.body
  }
  beforeAll(async()=>{
    const {version}=await setup(pool)
    await api('POST','/catalog/releases',{catalog_version:version,reason:'Renewal acceptance'})
    suspend=await plan(true);keep=await plan(false)
  })
  beforeEach(async()=>{await pool.query('TRUNCATE customers CASCADE');await pool.query('TRUNCATE commercial_outbox')})
  afterAll(async()=>{await pool.end()})
  async function subscription(p=suspend){
    const customer=randomUUID();await pool.query('INSERT INTO customers(id,name) VALUES($1,$2)',[customer,'Renewal customer'])
    const quote=await createQuoteForCustomer(pool,{customer_id:customer,request:{kind:'new',plan_revision_id:p.id,bundle_revision_ids:[],cadence:monthly,requested_extra_branches:0}})
    const {order}=await acceptQuote(pool,{quote_id:quote.id,expected_subscription_revision:0,idempotency_key:randomUUID()},vendor)
    await pool.query("UPDATE orders SET payment_state='paid',fulfillment_state='applied' WHERE id=$1",[order.id])
    await pool.query("UPDATE invoices SET status='paid',paid_at=now() WHERE order_id=$1",[order.id])
    await pool.query("UPDATE subscriptions SET applied_revision_id=target_revision_id,state='active',renewal_at='2026-10-01',revision=revision+1 WHERE id=$1",[order.subscription_id])
    return {customer,id:order.subscription_id}
  }
  const args=(adapter:SimulatorAdapter)=>({now,adapter,allowedOrigin:'https://nasq.test',return_path:'/subscription'})
  it('invoices once across repeated and concurrent generation, uses pinned price despite newer revision',async()=>{
    const s=await subscription()
    // Publish a new revision in the SAME plan family without changing the applied revision.
    const revised=await api('POST',`/plans/${suspend.id}/revisions`,{edit_revision:suspend.edit_revision,reason:'New higher pricing'})
    expect(revised.status).toBe(201)
    const edited=await api('PATCH',`/plans/${revised.body.id}`,{edit_revision:revised.body.edit_revision,name:revised.body.name,audience:revised.body.audience,term_months:12,currency:'SAR',platform_limits:{},included_bundle_revision_ids:[],optional_bundle_revision_ids:[],included_extra_branches:1,extra_branch_prices:[{cadence:monthly,amount:money(5000)}],extra_branches_limit:null,policy_revision_id:revised.body.policy_revision_id,trial_days:0,grace_days:2,auto_suspend:true,auto_renew_allowed:true,reason:'New higher pricing',prices:[{cadence:monthly,amount:money(90000)}]})
    expect(edited.status).toBe(200)
    const valid=await api('POST',`/plans/${revised.body.id}/validate`,{edit_revision:edited.body.edit_revision,reason:'New higher pricing'})
    await api('POST',`/plans/${revised.body.id}/publish`,{edit_revision:valid.body.edit_revision,reason:'New higher pricing'})
    const adapter=new SimulatorAdapter()
    await Promise.all([generateRenewals(pool,args(adapter)),generateRenewals(pool,args(adapter))]);await generateRenewals(pool,args(adapter))
    const rows=(await pool.query('SELECT i.total_minor,o.target_revision_id,s.applied_revision_id FROM renewals r JOIN invoices i ON i.id=r.invoice_id JOIN orders o ON o.id=r.order_id JOIN subscriptions s ON s.id=r.subscription_id WHERE r.subscription_id=$1',[s.id])).rows
    expect(rows).toHaveLength(1);expect(rows[0].total_minor).toBe('11500');expect(rows[0].target_revision_id).toBe(rows[0].applied_revision_id)
  })
  it('no consent never charges; charge response waits for lookup and paid renewal waits for receipt',async()=>{
    const no=await subscription(),yes=await subscription()
    await pool.query('UPDATE subscriptions SET provider_token_ref=$2,revision=revision+1 WHERE id=$1',[no.id,'token'])
    await pool.query('UPDATE subscriptions SET auto_renew_enabled=true,auto_renew_consent_at=$2,provider_token_ref=$3,revision=revision+1 WHERE id=$1',[yes.id,now,'token'])
    const adapter=new SimulatorAdapter().addToken('token'),charge=vi.spyOn(adapter,'chargeToken')
    await generateRenewals(pool,args(adapter))
    expect(charge).toHaveBeenCalledTimes(1)
    expect((await pool.query('SELECT status FROM payment_attempts a JOIN orders o ON o.id=a.order_id WHERE o.subscription_id=$1 AND o.kind=\'renewal\'',[no.id])).rows[0].status).toBe('redirected')
    const renewal=(await pool.query('SELECT o.id,o.payment_state,a.status FROM orders o JOIN payment_attempts a ON a.order_id=o.id WHERE o.subscription_id=$1 AND o.kind=\'renewal\'',[yes.id])).rows[0]
    expect(renewal).toMatchObject({payment_state:'awaiting_payment',status:'pending'})
    expect((await pool.query('SELECT status FROM renewals WHERE subscription_id=$1',[yes.id])).rows[0].status).toBe('charging')
    await markReturned(pool,{order_id:renewal.id,adapter})
    const paid=(await pool.query("SELECT state,renewal_at::text FROM subscriptions WHERE id=$1",[yes.id])).rows[0]
    expect(paid).toEqual({state:'active',renewal_at:'2026-10-01'})
    expect((await pool.query('SELECT status FROM renewals WHERE subscription_id=$1',[yes.id])).rows[0].status).toBe('paid')
    expect(await generateRenewals(pool,args(adapter))).toHaveLength(0)
    expect((await pool.query('SELECT count(*)::int AS n FROM renewals WHERE subscription_id=$1',[yes.id])).rows[0].n).toBe(1)
  })
  it('dunning marks past_due then suspends only when pinned auto_suspend allows',async()=>{
    const yes=await subscription(suspend),no=await subscription(keep)
    await generateRenewals(pool,args(new SimulatorAdapter()))
    // Invoice dates are immutable; simulate time after the actual issued due_at.
    const issued=(await pool.query('SELECT max(due_at) AS at FROM invoices WHERE subscription_id=ANY($1::uuid[])',[ [yes.id,no.id] ])).rows[0].at
    await applyDunning(pool,{now:new Date(new Date(issued).getTime()+1000)})
    expect((await pool.query('SELECT state FROM subscriptions WHERE id=ANY($1::uuid[])',[[yes.id,no.id]])).rows.map(r=>r.state)).toEqual(['past_due','past_due'])
    await applyDunning(pool,{now:new Date(new Date(issued).getTime()+3*86400000)})
    expect((await pool.query('SELECT state FROM subscriptions WHERE id=$1',[yes.id])).rows[0].state).toBe('suspended')
    expect((await pool.query('SELECT state FROM subscriptions WHERE id=$1',[no.id])).rows[0].state).toBe('past_due')
  })
  it('trial duration is computed from the supplied instant',()=>{
    expect(trialEndsAt(2,'2026-10-01T21:00:00Z')).toBe('2026-10-03T21:00:00.000Z')
    expect(()=>trialEndsAt(-1,now)).toThrow('invalid_trial')
  })
})
