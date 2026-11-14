import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { setup, client, money, monthly, seedPaymentMethod, url } from './commercial-helpers.js'
import { acceptQuote } from '../commercial/orders.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { SimulatorAdapter, type SimCardOutcome } from '../commercial/payment-simulator.js'
import { generateRenewals, applyDunning, trialEndsAt } from '../commercial/renewals.js'
import { chargeSavedCards } from '../commercial/saved-card-charges.js'
import { classifyDecline } from '../commercial/payment-decline.js'
import { armRefundLock } from '../commercial/free-base-lock.js'
import { transaction } from '../db.js'
import { riyadhDate } from '@liwan/commercial-contracts'
import { createPaymentAttempt, verifyReturnedAttempt } from '../commercial/payments.js'
import { CommercialHttpError } from '../commercial/lifecycle.js'
import { fixedReturnOrigin } from '../commercial/return-origin.js'

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
  const args=()=>({now,returnOrigin: fixedReturnOrigin('https://liwan.test')})
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
    await Promise.all([generateRenewals(pool,args()),generateRenewals(pool,args())]);await generateRenewals(pool,args())
    const rows=(await pool.query('SELECT i.total_minor,o.target_revision_id,s.applied_revision_id FROM renewals r JOIN invoices i ON i.id=r.invoice_id JOIN orders o ON o.id=r.order_id JOIN subscriptions s ON s.id=r.subscription_id WHERE r.subscription_id=$1',[s.id])).rows
    expect(rows).toHaveLength(1);expect(rows[0].total_minor).toBe('11500');expect(rows[0].target_revision_id).toBe(rows[0].applied_revision_id)
  })
  it('rejects an origin the provider would refuse before any renewal write',async()=>{
    const s=await subscription()
    const count=async()=>(await pool.query("SELECT (SELECT count(*)::int FROM renewals) AS renewals,(SELECT count(*)::int FROM orders WHERE kind='renewal') AS orders,(SELECT count(*)::int FROM invoices) AS invoices")).rows[0]
    const before=await count()
    for(const origin of ['http://billing.example.com','https://user:pw@billing.example.com'])
      await expect(generateRenewals(pool,{...args(),returnOrigin:fixedReturnOrigin(origin)})).rejects.toMatchObject({status:422,code:'return_url_forbidden'})
    expect(await count()).toEqual(before)
    expect((await pool.query('SELECT state FROM subscriptions WHERE id=$1',[s.id])).rows[0].state).toBe('active')
  })
  it('skips only the customer without a usable return origin, renews the others, and still fails the run',async()=>{
    const skipped=await subscription(),renewed=await subscription()
    const returnOrigin=async(customer:string)=>{if(customer===skipped.customer)throw new CommercialHttpError('return_url_forbidden',422);return 'https://liwan.test'}
    await expect(generateRenewals(pool,{now,returnOrigin})).rejects.toMatchObject({status:422,code:'return_url_forbidden'})
    const rows=(await pool.query('SELECT subscription_id FROM renewals')).rows.map(r=>r.subscription_id)
    expect(rows).toEqual([renewed.id])
    // Fixed later, the skipped customer renews on the next run without a duplicate for the other.
    await generateRenewals(pool,args())
    expect((await pool.query('SELECT subscription_id FROM renewals ORDER BY subscription_id')).rows.map(r=>r.subscription_id).sort()).toEqual([renewed.id,skipped.id].sort())
  })
  const chargeArgs=(adapter:SimulatorAdapter,at:Date=now)=>({now:at,adapter,returnOrigin:fixedReturnOrigin('https://liwan.test')})
  /** `plus` whole Riyadh days after the day the invoice was really issued (invoices take the database clock, not the test clock). */
  const dayOf=(issued:string,plus:number)=>new Date(Date.parse(`${issued}T09:00:00+03:00`)+plus*86_400_000)
  /** A renewal invoiced for a customer with a saved card and automatic renewal on; nothing is charged yet. */
  async function invoiced(card:{provider?:string;mode?:string}={}){
    const s=await subscription()
    const token=`token_secret_${randomUUID()}`
    const method=await seedPaymentMethod(pool,s.customer,token,card)
    await pool.query('UPDATE subscriptions SET auto_renew_enabled=true,auto_renew_consent_at=$2,revision=revision+1 WHERE id=$1',[s.id,now])
    await generateRenewals(pool,args())
    const order=(await pool.query("SELECT o.id,i.created_at FROM orders o JOIN invoices i ON i.order_id=o.id WHERE o.subscription_id=$1 AND o.kind='renewal'",[s.id])).rows[0]
    const adapter=new SimulatorAdapter().addToken(token)
    return {s,token,method,order:order.id as string,issued:riyadhDate(order.created_at),adapter,charge:vi.spyOn(adapter,'chargeToken')}
  }
  type Invoiced=Awaited<ReturnType<typeof invoiced>>
  const attemptsOf=async(order:string)=>(await pool.query('SELECT id,kind,status,provider_ref FROM payment_attempts WHERE order_id=$1 ORDER BY created_at,id',[order])).rows
  const noticesOf=async(subscription:string,type:string)=>(await pool.query("SELECT payload FROM commercial_outbox WHERE kind='billing.notice' AND aggregate_id=$1 AND payload->>'type'=$2 ORDER BY created_at,id",[subscription,type])).rows.map(r=>r.payload)
  const methodStatus=async(id:string)=>(await pool.query('SELECT status FROM payment_methods WHERE id=$1',[id])).rows[0].status
  it('generating a renewal charges nothing: the card is charged by the one charging step',async()=>{
    const f=await invoiced()
    expect(f.charge).not.toHaveBeenCalled()
    expect(await attemptsOf(f.order)).toEqual([])
    expect((await pool.query('SELECT status FROM renewals WHERE order_id=$1',[f.order])).rows[0].status).toBe('invoiced')
  })
  it('charges only with automatic renewal on and its consent; the charge waits for lookup and a paid renewal waits for receipt',async()=>{
    const no=await invoiced(),yes=await invoiced()
    await pool.query('UPDATE subscriptions SET auto_renew_enabled=false,revision=revision+1 WHERE id=$1',[no.s.id])
    await chargeSavedCards(pool,{...chargeArgs(no.adapter,dayOf(no.issued,0)),subscription_id:no.s.id})
    await chargeSavedCards(pool,{...chargeArgs(yes.adapter,dayOf(yes.issued,0)),subscription_id:yes.s.id})
    expect(no.charge).not.toHaveBeenCalled()
    expect(await attemptsOf(no.order)).toEqual([])
    expect(yes.charge).toHaveBeenCalledTimes(1)
    const [attempt]=await attemptsOf(yes.order)
    expect(attempt).toMatchObject({kind:'saved_card',status:'pending'})
    expect(yes.charge.mock.calls[0]![0].given_id).toBe(attempt.id)
    expect(attempt.provider_ref).toBe(attempt.id)
    expect(yes.charge.mock.calls[0]![0].callback_url).toBe(`https://liwan.test/api/commercial/payment-callback?attempt=${attempt.id}`)
    expect((await pool.query('SELECT payment_state FROM orders WHERE id=$1',[yes.order])).rows[0].payment_state).toBe('awaiting_payment')
    expect((await pool.query('SELECT status FROM renewals WHERE order_id=$1',[yes.order])).rows[0].status).toBe('charging')
    await pool.query("UPDATE payment_attempts SET updated_at=now()-interval '10 seconds' WHERE id=$1",[attempt.id])
    const byInvoice=vi.spyOn(yes.adapter,'lookupAttempt'),byPayment=vi.spyOn(yes.adapter,'lookupPayment')
    await verifyReturnedAttempt(pool,{attempt_id:attempt.id,customer_id:yes.s.customer,adapter:yes.adapter})
    expect(byPayment).toHaveBeenCalledTimes(1);expect(byInvoice).not.toHaveBeenCalled() // a payment id is not an invoice id
    expect((await pool.query('SELECT status FROM renewals WHERE order_id=$1',[yes.order])).rows[0].status).toBe('paid')
    // Paid: nothing is charged again.
    expect(await chargeSavedCards(pool,chargeArgs(yes.adapter,dayOf(yes.issued,5)))).toEqual({charged:0,failed:0})
    expect(yes.charge).toHaveBeenCalledTimes(1)
  })
  it('a soft decline closes the attempt, leaves the order payable with no hosted link, and is retried on day 1, 3 and 5, then never again',async()=>{
    const f=await invoiced()
    f.adapter.scriptTokenCharge(f.token,{outcome:'declined',message:'INSUFFICIENT FUNDS'})
    const run=(plus:number)=>chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,plus)))
    await run(0)
    let attempts=await attemptsOf(f.order)
    expect(attempts.map(a=>[a.kind,a.status])).toEqual([['saved_card','failed']])
    expect((await pool.query('SELECT payment_state FROM orders WHERE id=$1',[f.order])).rows[0].payment_state).toBe('awaiting_payment')
    expect((await pool.query("SELECT action,reason,metadata FROM audit_events WHERE subject=$1 AND action LIKE 'payment.saved_card%'",[f.order])).rows)
      .toEqual([expect.objectContaining({action:'payment.saved_card_declined',metadata:expect.objectContaining({message:'INSUFFICIENT FUNDS',decline:'soft',attempt_id:attempts[0].id})})])
    expect(await methodStatus(f.method)).toBe('active')
    expect((await pool.query('SELECT status FROM renewals WHERE order_id=$1',[f.order])).rows[0].status).toBe('invoiced')
    await run(0);expect(f.charge).toHaveBeenCalledTimes(1) // the same day never charges twice
    await run(1);expect(f.charge).toHaveBeenCalledTimes(2)
    await run(2);expect(f.charge).toHaveBeenCalledTimes(2)
    await run(3);expect(f.charge).toHaveBeenCalledTimes(3)
    await run(4);expect(f.charge).toHaveBeenCalledTimes(3)
    await run(5);expect(f.charge).toHaveBeenCalledTimes(4)
    await run(9);await run(30);expect(f.charge).toHaveBeenCalledTimes(4)
    attempts=await attemptsOf(f.order)
    expect(attempts).toHaveLength(4)
    expect(new Set(attempts.map(a=>a.id)).size).toBe(4) // each try has an attempt of its own, and its id is the given id
    expect(f.charge.mock.calls.map(c=>c[0].given_id)).toEqual(attempts.map(a=>a.id))
    expect((await noticesOf(f.s.id,'card_charge_failed')).map(n=>n.retry_on)).toEqual([dayOf(f.issued,1),dayOf(f.issued,3),dayOf(f.issued,5)].map(d=>riyadhDate(d)).flatMap((d,i,all)=>i===all.length-1?[d,undefined]:[d]))
    expect(await methodStatus(f.method)).toBe('active')
  })
  it.each(['DECLINED: LOST CARD','DECLINED: STOLEN CARD','DECLINED: EXPIRED CARD','3DS: Card authentication declined.'])('a hard decline (%s) stops at once, marks the card inactive and says no retry will follow',async message=>{
    const f=await invoiced()
    f.adapter.scriptTokenCharge(f.token,{outcome:'declined',message})
    await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0)))
    expect(await methodStatus(f.method)).toBe('inactive')
    expect((await noticesOf(f.s.id,'card_charge_failed'))).toEqual([expect.not.objectContaining({retry_on:expect.anything()})])
    await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,1)))
    expect(f.charge).toHaveBeenCalledTimes(1)
  })
  it.each([['INSUFFICIENT FUNDS'],['DECLINED'],['DECLINED: EXCEEDS WITHDRAWAL LIMIT'],['UNSPECIFIED FAILURE'],['A MESSAGE NOBODY HAS SEEN'],[null]])('treats the message %j as soft: the card stays and the next day is tried',async message=>{
    const f=await invoiced()
    f.adapter.scriptTokenCharge(f.token,{outcome:'declined',message:message as string})
    await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0)))
    await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,1)))
    expect(f.charge).toHaveBeenCalledTimes(2)
    expect(await methodStatus(f.method)).toBe('active')
  })
  it('classifies every message recorded in the spike, and an unknown or missing one as soft',()=>{
    expect(['DECLINED: LOST CARD','DECLINED: STOLEN CARD','DECLINED: EXPIRED CARD','declined: lost card ','3DS: service error occurred.'].map(classifyDecline)).toEqual(Array(5).fill('hard'))
    expect(['INSUFFICIENT FUNDS','DECLINED','DECLINED: EXCEEDS WITHDRAWAL LIMIT','UNSPECIFIED FAILURE','??',null,undefined].map(classifyDecline)).toEqual(Array(7).fill('soft'))
  })
  it.each([['needs_customer_action'],['token_unusable']] as const)('a charge that is %s closes the attempt, deactivates the card, offers no hosted link and stops',async outcome=>{
    const f=await invoiced()
    f.adapter.scriptTokenCharge(f.token,{outcome})
    await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0)))
    expect((await attemptsOf(f.order)).map(a=>[a.kind,a.status])).toEqual([['saved_card','failed']])
    expect(await methodStatus(f.method)).toBe('inactive')
    const audit=(await pool.query("SELECT action,metadata FROM audit_events WHERE subject=$1 AND action LIKE 'payment.saved_card%'",[f.order])).rows
    expect(JSON.stringify(audit)).not.toMatch(/https?:|token_secret/)
    await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,1)))
    expect(f.charge).toHaveBeenCalledTimes(1)
  })
  it('a lost answer keeps its attempt: it is looked up by the attempt id first, then sent again with the same id',async()=>{
    const f=await invoiced()
    f.adapter.scriptTokenCharge(f.token,{outcome:'unknown'})
    await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0)))
    const [first]=await attemptsOf(f.order)
    expect(first).toMatchObject({kind:'saved_card',status:'unknown',provider_ref:first.id})
    // Too soon: nothing happens (the reconciler owns the first minutes).
    await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0)))
    expect(f.charge).toHaveBeenCalledTimes(1)
    await pool.query("UPDATE payment_attempts SET updated_at=now()-interval '10 minutes' WHERE id=$1",[first.id])
    f.adapter.scriptTokenCharge(f.token,{outcome:'paid'})
    const lookup=vi.spyOn(f.adapter,'lookupPayment')
    await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0)))
    expect(lookup).toHaveBeenCalledWith(first.id)
    expect(f.charge).toHaveBeenCalledTimes(2)
    expect(f.charge.mock.calls[1]![0].given_id).toBe(first.id)
    const attempts=await attemptsOf(f.order)
    expect(attempts).toEqual([expect.objectContaining({id:first.id,status:'pending'})])
  })
  it('a charge the provider already holds is found by the attempt id, never charged twice',async()=>{
    const f=await invoiced()
    f.adapter.scriptTokenCharge(f.token,{outcome:'used_given_id'})
    await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0)))
    expect(await attemptsOf(f.order)).toEqual([expect.objectContaining({kind:'saved_card',status:'succeeded'})])
    expect((await pool.query('SELECT payment_state FROM orders WHERE id=$1',[f.order])).rows[0].payment_state).toBe('paid')
    const missing=await invoiced()
    missing.adapter.scriptTokenCharge(missing.token,{outcome:'used_given_id',thenPaid:false})
    await chargeSavedCards(pool,chargeArgs(missing.adapter,dayOf(missing.issued,0)))
    expect(await attemptsOf(missing.order)).toEqual([expect.objectContaining({kind:'saved_card',status:'unknown'})])
  })
  it('does not charge a card saved at another provider or mode, says so once without the token, and the invoice stays payable',async()=>{
    for(const card of [{provider:'moyasar',mode:'live'},{mode:'test'}]){
      const f=await invoiced(card)
      await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0)))
      await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,1)))
      expect(f.charge).not.toHaveBeenCalled()
      expect(await attemptsOf(f.order)).toEqual([])
      const audit=(await pool.query("SELECT action,metadata FROM audit_events WHERE subject=$1 AND action='payment.saved_card_unusable'",[f.order])).rows
      expect(audit).toEqual([expect.objectContaining({metadata:expect.objectContaining({adapter_provider:'simulator',adapter_mode:'simulator',method_mode:card.mode})})])
      expect(JSON.stringify(audit)).not.toContain('token_secret')
    }
  })
  describe('guards re-checked under the subscription lock',()=>{
    const guards:[string,(f:Invoiced)=>Promise<unknown>][]=[
      ['automatic renewal off',f=>pool.query('UPDATE subscriptions SET auto_renew_enabled=false,revision=revision+1 WHERE id=$1',[f.s.id])],
      ['a scheduled cancellation',f=>pool.query("UPDATE subscriptions SET cancel_requested_at=now(),cancel_requested_by='customer',revision=revision+1 WHERE id=$1",[f.s.id])],
      ['a vendor suspension',f=>pool.query('UPDATE subscriptions SET manual_suspension=true,revision=revision+1 WHERE id=$1',[f.s.id])],
      ['a suspended subscription',f=>pool.query("UPDATE subscriptions SET state='suspended',revision=revision+1 WHERE id=$1",[f.s.id])],
      ['a pending plan change',f=>pool.query('UPDATE subscriptions SET target_revision_id=applied_revision_id,revision=revision+1 WHERE id=$1',[f.s.id])],
      ['an armed free-base lock',f=>pool.query(`INSERT INTO free_base_locks(subscription_id,pre_lock_revision_id,period_start,armed_at,trial_ended_at,cause,next_attempt_at)
        SELECT id,applied_revision_id,'2026-10-01',now(),NULL,'refund',now() FROM subscriptions WHERE id=$1`,[f.s.id])],
      ['a confirmed workspace deletion',f=>pool.query(`INSERT INTO tenant_deletion_requests(id,customer_id,state,requested_at,requested_by,confirmed_at,confirmed_by,due_at,renewal_outcome) VALUES($1,$2,'confirmed',now(),'7',now(),'7',now()+interval '30 days','cancelled')`,[randomUUID(),f.s.customer])],
      ['an expired card',f=>pool.query('UPDATE payment_methods SET exp_month=1,exp_year=2026 WHERE id=$1',[f.method])],
      ['an inactive card',f=>pool.query("UPDATE payment_methods SET status='inactive' WHERE id=$1",[f.method])],
      ['a removed card',f=>pool.query("UPDATE payment_methods SET status='removed',is_default=false,provider_token=NULL,removed_at=now(),removed_by='customer' WHERE id=$1",[f.method])],
    ]
    it.each(guards)('%s: no charge, and the invoice stays payable by hand',async(_name,breakIt)=>{
      const f=await invoiced()
      await breakIt(f)
      await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0)))
      expect(f.charge).not.toHaveBeenCalled()
      expect(await attemptsOf(f.order)).toEqual([])
      expect((await pool.query('SELECT payment_state FROM orders WHERE id=$1',[f.order])).rows[0].payment_state).toBe('awaiting_payment')
    })
    it('a card that expires between invoice and retry is not charged on the retry day',async()=>{
      const f=await invoiced()
      await pool.query('UPDATE payment_methods SET exp_month=$2,exp_year=$3 WHERE id=$1',[f.method,Number(f.issued.slice(5,7)),Number(f.issued.slice(0,4))]) // valid through the end of the issue month
      f.adapter.scriptTokenCharge(f.token,{outcome:'declined',message:'INSUFFICIENT FUNDS'})
      await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0)))
      expect(f.charge).toHaveBeenCalledTimes(1)
      await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,40)))
      expect(f.charge).toHaveBeenCalledTimes(1)
    })
    it('resuming a scheduled cancellation restores charging',async()=>{
      const f=await invoiced()
      await pool.query("UPDATE subscriptions SET cancel_requested_at=now(),cancel_requested_by='customer',revision=revision+1 WHERE id=$1",[f.s.id])
      await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0)))
      expect(f.charge).not.toHaveBeenCalled()
      await pool.query('UPDATE subscriptions SET cancel_requested_at=NULL,cancel_requested_by=NULL,revision=revision+1 WHERE id=$1',[f.s.id])
      await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0)))
      expect(f.charge).toHaveBeenCalledTimes(1)
    })
    it('a suspended tenant is not charged but can pay the open invoice by form',async()=>{
      const f=await invoiced()
      await pool.query("UPDATE subscriptions SET state='suspended',revision=revision+1 WHERE id=$1",[f.s.id])
      await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0)))
      expect(f.charge).not.toHaveBeenCalled()
      const session=await createPaymentAttempt(pool,{order_id:f.order,customer_id:f.s.customer,adapter:f.adapter,returnOrigin:fixedReturnOrigin('https://liwan.test'),actor:'7',request:{method:'form',save_card:false}})
      expect(session.intent.client_secret).toBeTruthy()
    })
    it('a customer paying by form on the same order is never charged on top of',async()=>{
      const f=await invoiced()
      await createPaymentAttempt(pool,{order_id:f.order,customer_id:f.s.customer,adapter:f.adapter,returnOrigin:fixedReturnOrigin('https://liwan.test'),actor:'7',request:{method:'form',save_card:false}})
      await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0)))
      expect(f.charge).not.toHaveBeenCalled()
    })
  })
  it('arming the refund lock switches automatic renewal off and keeps the card',async()=>{
    const f=await invoiced()
    await transaction(pool,client=>armRefundLock(client,{subscription_id:f.s.id,now}))
    const row=(await pool.query('SELECT auto_renew_enabled FROM subscriptions WHERE id=$1',[f.s.id])).rows[0]
    expect(row.auto_renew_enabled).toBe(false)
    expect(await methodStatus(f.method)).toBe('active')
    expect((await pool.query("SELECT actor,reason FROM audit_events WHERE subject=$1 AND action='auto_renew.disabled'",[f.s.id])).rows).toHaveLength(1)
  })
  it('a renewal pays through the saved card across the scheduler tick order: generate, charge, then dunning',async()=>{
    const f=await invoiced()
    await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0)))
    const [attempt]=await attemptsOf(f.order)
    await pool.query("UPDATE payment_attempts SET updated_at=now()-interval '10 seconds' WHERE id=$1",[attempt.id])
    await verifyReturnedAttempt(pool,{attempt_id:attempt.id,customer_id:f.s.customer,adapter:f.adapter})
    expect(await applyDunning(pool,{now:dayOf(f.issued,60)})).toEqual([])
  })
  it('dunning marks past_due then suspends only when pinned auto_suspend allows',async()=>{
    const yes=await subscription(suspend),no=await subscription(keep)
    await generateRenewals(pool,args())
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
