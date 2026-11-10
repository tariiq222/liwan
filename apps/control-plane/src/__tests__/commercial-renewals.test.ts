import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { setup, client, money, monthly, url } from './commercial-helpers.js'
import { acceptQuote } from '../commercial/orders.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'
import { generateRenewals, applyDunning, trialEndsAt } from '../commercial/renewals.js'
import { CommercialHttpError } from '../commercial/lifecycle.js'
import { fixedReturnOrigin } from '../commercial/return-origin.js'
import { attention } from '../commercial/attention.js'
import { claimForSend, reconcileTokenCharges } from '../commercial/token-charge.js'

const suite=url?describe:describe.skip
suite('live PostgreSQL pinned subscription renewals',()=>{
  const pool=new Pool({connectionString:url,max:8}),api=client(pool)
  const vendor:any={actor_id:'7',kind:'vendor',customer_id:null,tenant_id:null,capabilities:['vendor.subscriptions.manage']}
  const now=new Date('2026-10-02T08:00:00Z')
  let suspend:any,keep:any
  async function plan(auto_suspend:boolean,price=10000){
    const c=await api('POST','/plans',{name:`Renewal ${randomUUID()}`,audience:{kind:'public'},term_months:12,currency:'SAR',prices:[{cadence:monthly,amount:money(price)}],platform_limits: {},included_bundle_revision_ids:[],optional_bundle_revision_ids:[],included_extra_branches:1,extra_branch_prices:[{cadence:monthly,amount:money(5000)}],extra_branches_limit:null,included_users:1,included_storage_mb:0,storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400, user_prices:[{cadence:monthly,amount:money(0)}],storage_prices:[{cadence:monthly,amount:money(0)}],policy_revision_id:'6f1c3d8e-0000-4000-8000-000000000001',trial_days:0,grace_days:2,auto_suspend,auto_renew_allowed:true})
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
    const customer=randomUUID();await pool.query('INSERT INTO customers(id,name,admin_name,admin_login) VALUES($1,$2,$3,$4)',[customer,'Renewal customer','Manager','renewals@example.test'])
    const quote=await createQuoteForCustomer(pool,{customer_id:customer,request:{kind:'new',plan_revision_id:p.id,bundle_revision_ids:[],cadence:monthly,requested_extra_branches:0,requested_users:1,requested_storage_mb:0}})
    const {order}=await acceptQuote(pool,{quote_id:quote.id,expected_subscription_revision:0,idempotency_key:randomUUID()},vendor)
    await pool.query("UPDATE orders SET payment_state='paid',fulfillment_state='applied' WHERE id=$1",[order.id])
    await pool.query("UPDATE invoices SET status='paid',paid_at=now() WHERE order_id=$1",[order.id])
    await pool.query("UPDATE subscriptions SET applied_revision_id=target_revision_id,target_revision_id=NULL,state='active',renewal_at='2026-10-01',revision=revision+1 WHERE id=$1",[order.subscription_id])
    return {customer,id:order.subscription_id}
  }
  const args=(adapter:SimulatorAdapter)=>({now,adapter,returnOrigin: fixedReturnOrigin('https://liwan.test')})
  it('invoices once across repeated and concurrent generation, uses pinned price despite newer revision',async()=>{
    const s=await subscription()
    // Publish a new revision in the SAME plan family without changing the applied revision.
    const revised=await api('POST',`/plans/${suspend.id}/revisions`,{edit_revision:suspend.edit_revision,reason:'New higher pricing'})
    expect(revised.status).toBe(201)
    const edited=await api('PATCH',`/plans/${revised.body.id}`,{edit_revision:revised.body.edit_revision,name:revised.body.name,audience:revised.body.audience,term_months:12,currency:'SAR',platform_limits: {},included_bundle_revision_ids:[],optional_bundle_revision_ids:[],included_extra_branches:1,extra_branch_prices:[{cadence:monthly,amount:money(5000)}],extra_branches_limit:null,included_users:1,included_storage_mb:0,storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400, user_prices:[{cadence:monthly,amount:money(0)}],storage_prices:[{cadence:monthly,amount:money(0)}],policy_revision_id:revised.body.policy_revision_id,trial_days:0,grace_days:2,auto_suspend:true,auto_renew_allowed:true,reason:'New higher pricing',prices:[{cadence:monthly,amount:money(90000)}]})
    expect(edited.status).toBe(200)
    const valid=await api('POST',`/plans/${revised.body.id}/validate`,{edit_revision:edited.body.edit_revision,reason:'New higher pricing'})
    suspend=(await api('POST',`/plans/${revised.body.id}/publish`,{edit_revision:valid.body.edit_revision,reason:'New higher pricing'})).body
    const adapter=new SimulatorAdapter()
    await Promise.all([generateRenewals(pool,args(adapter)),generateRenewals(pool,args(adapter))]);await generateRenewals(pool,args(adapter))
    const rows=(await pool.query('SELECT i.total_minor,o.target_revision_id,s.applied_revision_id FROM renewals r JOIN invoices i ON i.id=r.invoice_id JOIN orders o ON o.id=r.order_id JOIN subscriptions s ON s.id=r.subscription_id WHERE r.subscription_id=$1',[s.id])).rows
    expect(rows).toHaveLength(1);expect(rows[0].total_minor).toBe('11500');expect(rows[0].target_revision_id).toBe(rows[0].applied_revision_id)
  })
  it('rejects an origin the provider would refuse before any renewal write',async()=>{
    const s=await subscription()
    const count=async()=>(await pool.query("SELECT (SELECT count(*)::int FROM renewals) AS renewals,(SELECT count(*)::int FROM orders WHERE kind='renewal') AS orders,(SELECT count(*)::int FROM invoices) AS invoices")).rows[0]
    const before=await count()
    for(const origin of ['http://billing.example.com','https://user:pw@billing.example.com'])
      await expect(generateRenewals(pool,{...args(new SimulatorAdapter()),returnOrigin:fixedReturnOrigin(origin)})).rejects.toMatchObject({status:422,code:'return_url_forbidden'})
    expect(await count()).toEqual(before)
    expect((await pool.query('SELECT state FROM subscriptions WHERE id=$1',[s.id])).rows[0].state).toBe('active')
  })
  it('skips only the customer without a usable return origin, renews the others, and still fails the run',async()=>{
    const skipped=await subscription(),renewed=await subscription()
    const returnOrigin=async(customer:string)=>{if(customer===skipped.customer)throw new CommercialHttpError('return_url_forbidden',422);return 'https://liwan.test'}
    await expect(generateRenewals(pool,{now,adapter:new SimulatorAdapter(),returnOrigin})).rejects.toMatchObject({status:422,code:'return_url_forbidden'})
    const rows=(await pool.query('SELECT subscription_id FROM renewals')).rows.map(r=>r.subscription_id)
    expect(rows).toEqual([renewed.id])
    // Fixed later, the skipped customer renews on the next run without a duplicate for the other.
    await generateRenewals(pool,args(new SimulatorAdapter()))
    expect((await pool.query('SELECT subscription_id FROM renewals ORDER BY subscription_id')).rows.map(r=>r.subscription_id).sort()).toEqual([renewed.id,skipped.id].sort())
  })
  it('does not send stored-method charges until the notice gate and setup are available', async () => {
    const { id } = await subscription()
    await pool.query(`INSERT INTO payment_methods(id,subscription_id,provider,state,token_ciphertext,key_id,consent_at,consent_actor,consent_version)
      VALUES($1,$2,'simulator','active',$3,'fixture-key',now(),'fixture','fixture')`, [randomUUID(),id,Buffer.from([1])])
    const adapter = new SimulatorAdapter()
    const charge = vi.spyOn(adapter, 'chargeToken')
    await generateRenewals(pool, args(adapter))
    expect(charge).not.toHaveBeenCalled()
    expect((await pool.query(`SELECT a.status,a.token_charge FROM payment_attempts a JOIN orders o ON o.id=a.order_id
      WHERE o.subscription_id=$1 AND o.kind='renewal'`, [id])).rows).toEqual([{ status:'redirected', token_charge:false }])
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
  it('holds dunning and vendor overdue attention until the stored charge is closed', async () => {
    const { id, customer } = await subscription(suspend)
    const adapter = new SimulatorAdapter()
    vi.stubEnv('LIWAN_INVOICE_DUE_DAYS', '0')
    try { await generateRenewals(pool,args(adapter)) } finally { vi.unstubAllEnvs() }
    const issued = (await pool.query(`SELECT i.id,i.order_id,i.due_at,a.id AS attempt_id FROM invoices i
      JOIN payment_attempts a ON a.invoice_id=i.id WHERE i.subscription_id=$1 AND i.kind='renewal'`, [id])).rows[0]
    const method = randomUUID(), notice = randomUUID(), attempt = randomUUID()
    await pool.query(`INSERT INTO payment_methods(id,subscription_id,provider,state,token_ciphertext,key_id,consent_at,consent_actor,consent_version)
      VALUES($1,$2,'simulator','active',$3,'fixture-key','2026-09-01','fixture','fixture')`, [method,id,Buffer.from([1])])
    await pool.query(`INSERT INTO renewal_notices(id,subscription_id,method_id,renewal_date,cadence_unit,cadence_count,
      amount_minor,currency,exponent,state,sent_at)
      SELECT $1,i.subscription_id,$2,i.period_start,'month',1,i.total_minor,i.currency,i.exponent,'sent','2026-09-20'
      FROM invoices i WHERE i.id=$3`, [notice,method,issued.id])
    await pool.query("UPDATE payment_attempts SET status='canceled' WHERE id=$1", [issued.attempt_id])
    await pool.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,amount_minor,currency,exponent,created_at,token_charge,method_id,notice_id)
      SELECT $1,i.order_id,i.id,'simulator','simulator',i.total_minor,i.currency,i.exponent,i.due_at,true,$2,$3 FROM invoices i WHERE i.id=$4`,
    [attempt,method,notice,issued.id])
    await claimForSend(pool, attempt, () => issued.due_at.getTime())
    const afterGrace = new Date(issued.due_at.getTime() + 3 * 86_400_000)
    const state = async () => (await pool.query('SELECT state FROM subscriptions WHERE id=$1',[id])).rows[0].state
    await applyDunning(pool, { now: afterGrace })
    expect(await state()).toBe('active')
    const pastDue = async () => (await attention(pool, true)).items.some(item => item.kind === 'past_due' && item.customer_id === customer)
    expect(await pastDue()).toBe(false)
    await reconcileTokenCharges(pool, adapter, afterGrace)
    expect(await pastDue()).toBe(true)
    await applyDunning(pool, { now: afterGrace })
    expect(await state()).toBe('suspended')
  })
  it('trial duration is computed from the supplied instant',()=>{
    expect(trialEndsAt(2,'2026-10-01T21:00:00Z')).toBe('2026-10-03T21:00:00.000Z')
    expect(()=>trialEndsAt(-1,now)).toThrow('invalid_trial')
  })
})
