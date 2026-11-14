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
import { createPaymentAttempt, handleProviderEvent, reconcileUnknownAttempts, verifyReturnedAttempt } from '../commercial/payments.js'
import { PaymentError } from '../commercial/payment-adapter.js'
import { disableAutoRenew, disableAutoRenewIfPlanForbids } from '../commercial/auto-renew.js'
import { removePaymentMethod } from '../commercial/payment-method-removal.js'
import { attention } from '../commercial/attention.js'
import { buildAttemptDescription } from '../commercial/payment-description.js'
import { CommercialHttpError } from '../commercial/lifecycle.js'
import { fixedReturnOrigin } from '../commercial/return-origin.js'

const suite=url?describe:describe.skip
suite('live PostgreSQL pinned subscription renewals',()=>{
  const pool=new Pool({connectionString:url,max:8}),api=client(pool)
  const vendor:any={actor_id:'7',kind:'vendor',customer_id:null,tenant_id:null,capabilities:['vendor.subscriptions.manage']}
  const now=new Date('2026-10-02T08:00:00Z')
  let suspend:any,keep:any,noRenew:any,tiny:any
  async function plan(auto_suspend:boolean,price=10000,autoRenew=true){
    const c=await api('POST','/plans',{name:`Renewal ${randomUUID()}`,audience:{kind:'public'},term_months:12,currency:'SAR',prices:[{cadence:monthly,amount:money(price)}],platform_limits: {},included_bundle_revision_ids:[],optional_bundle_revision_ids:[],included_extra_branches:1,extra_branch_prices:[{cadence:monthly,amount:money(5000)}],extra_branches_limit:null,included_users:1,included_storage_mb:0,storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400, user_prices:[{cadence:monthly,amount:money(0)}],storage_prices:[{cadence:monthly,amount:money(0)}],policy_revision_id:'6f1c3d8e-0000-4000-8000-000000000001',trial_days:0,grace_days:2,auto_suspend,auto_renew_allowed:autoRenew})
    expect(c.status).toBe(201)
    const v=await api('POST',`/plans/${c.body.id}/validate`,{edit_revision:1,reason:'Renewal acceptance'})
    const p=await api('POST',`/plans/${c.body.id}/publish`,{edit_revision:v.body.edit_revision,reason:'Renewal acceptance'})
    expect(p.status).toBe(200);return p.body
  }
  beforeAll(async()=>{
    const {version}=await setup(pool)
    await api('POST','/catalog/releases',{catalog_version:version,reason:'Renewal acceptance'})
    suspend=await plan(true);keep=await plan(false);noRenew=await plan(true,10000,false);tiny=await plan(true,50)
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
  async function invoiced(card:{provider?:string;mode?:string}={},p=suspend){
    const s=await subscription(p)
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
    // One notice per failed try; what it says about the next try is worked out from live state when it is sent.
    expect((await noticesOf(f.s.id,'card_charge_failed')).map(n=>n.decline)).toEqual(['soft','soft','soft','soft'])
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
    expect(['DECLINED: LOST CARD','DECLINED: STOLEN CARD','DECLINED: EXPIRED CARD','declined: lost card ','3DS: service error occurred.','3DS: Card authentication declined.',
      'DECLINED: RESTRICTED CARD','DECLINED: SUSPECTED FRAUD','DECLINED: CARD NOT PERMITTED','DECLINED: INVALID CARD NUMBER','DECLINED: CLOSED ACCOUNT'].map(classifyDecline)).toEqual(Array(11).fill('hard'))
    // The issuer's own outage and the ambiguous holds are soft; an unknown message is soft.
    expect(['INSUFFICIENT FUNDS','DECLINED','DECLINED: EXCEEDS WITHDRAWAL LIMIT','UNSPECIFIED FAILURE','??',null,undefined,'DECLINED: DO NOT HONOR','DECLINED: PICK UP CARD',
      '3DS: The authentication is unavailable, please try again later or contact issuer bank if problem persisted.'].map(classifyDecline)).toEqual(Array(10).fill('soft'))
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
    await pool.query("UPDATE payment_attempts SET charge_sent_at=now()-interval '6 minutes' WHERE id=$1",[first.id])
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

  describe('review fixes of the charging step',()=>{
    const savedAttempt=async(order:string)=>(await pool.query("SELECT * FROM payment_attempts WHERE order_id=$1 AND kind='saved_card' ORDER BY created_at,id",[order])).rows
    const hold=(f:Invoiced)=>pool.query("SELECT payment_hold_until FROM payment_attempts WHERE order_id=$1 AND kind='form' AND payment_hold_until IS NOT NULL",[f.order]).then(r=>r.rows[0]?.payment_hold_until as Date|null)
    /** The failed payment the provider holds under the attempt's id, as a lost answer leaves it. */
    const failedAtProvider=(f:Invoiced,attempt:any,message:string)=>f.adapter.directPayment({payment_id:attempt.id,status:'failed',amount:{minor:Number(attempt.amount_minor),currency:attempt.currency,exponent:attempt.exponent},
      description:`LiwanOS renewal ${f.order}`,callback_url:'https://liwan.test/x',decline_message:message} as any)
    const stale=(id:string)=>pool.query("UPDATE payment_attempts SET charge_sent_at=now()-interval '6 minutes',updated_at=now() WHERE id=$1",[id])

    it('does not charge while a closed card form attempt may still hold a payment, and ends the hold when it is settled, declined, expired or the order is gone',async()=>{
      const f=await invoiced()
      const origin=fixedReturnOrigin('https://liwan.test')
      const session=await createPaymentAttempt(pool,{order_id:f.order,customer_id:f.s.customer,adapter:f.adapter,returnOrigin:origin,actor:'7',request:{method:'form',save_card:false}})
      f.adapter.fulfilIntent(session.intent.id,{clientSecret:session.intent.client_secret}) // the payer paid; no payment was ever reported
      await pool.query("UPDATE payment_attempts SET created_at=now()-interval '56 minutes' WHERE id=$1",[session.attempt_id])
      await createPaymentAttempt(pool,{order_id:f.order,customer_id:f.s.customer,adapter:f.adapter,returnOrigin:origin,actor:'7',request:{method:'form',save_card:false}})
      expect(await hold(f)).toBeInstanceOf(Date)
      // The customer's fresh form (opened by that re-entry) is not what is under test: only the closed attempt's hold is.
      await pool.query("UPDATE payment_attempts SET status='canceled' WHERE order_id=$1 AND kind='form' AND payment_hold_until IS NULL",[f.order])
      await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0)))
      expect(f.charge).not.toHaveBeenCalled()
      // The hold has a bound: after it, nothing says a payment is still coming.
      await pool.query("UPDATE payment_attempts SET payment_hold_until=now()-interval '1 minute' WHERE order_id=$1 AND kind='form'",[f.order])
      await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0)))
      expect(f.charge).toHaveBeenCalledTimes(1)
    })
    it.each([['its decline is recorded',"declined_payment_ref='pay_declined_1'"],['a payment is bound to it',"provider_ref='pay_bound_1'"]])('a closed form attempt stops holding the invoice when %s',async(_name,set)=>{
      const f=await invoiced()
      const session=await createPaymentAttempt(pool,{order_id:f.order,customer_id:f.s.customer,adapter:f.adapter,returnOrigin:fixedReturnOrigin('https://liwan.test'),actor:'7',request:{method:'form',save_card:false}})
      await pool.query(`UPDATE payment_attempts SET status='canceled',payment_hold_until=now()+interval '5 hours' WHERE id=$1`,[session.attempt_id])
      await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0)))
      expect(f.charge).not.toHaveBeenCalled()
      await pool.query(`UPDATE payment_attempts SET ${set} WHERE id=$1`,[session.attempt_id])
      await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0)))
      expect(f.charge).toHaveBeenCalledTimes(1)
    })
    it('a plan that forbids automatic renewal is never charged, the customer is told once, and applying such a plan switches it off with an audit row',async()=>{
      const f=await invoiced({},noRenew)
      await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0)));await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,1)))
      expect(f.charge).not.toHaveBeenCalled()
      expect((await noticesOf(f.s.id,'card_charge_skipped')).map(n=>n.skip_reason)).toEqual(['plan_not_allowed'])
      await transaction(pool,async c=>{expect(await disableAutoRenewIfPlanForbids(c,f.s.id)).toBe(true);expect(await disableAutoRenewIfPlanForbids(c,f.s.id)).toBe(false)})
      expect((await pool.query('SELECT auto_renew_enabled FROM subscriptions WHERE id=$1',[f.s.id])).rows[0].auto_renew_enabled).toBe(false)
      expect((await pool.query("SELECT reason FROM audit_events WHERE subject=$1 AND action='auto_renew.disabled'",[f.s.id])).rows).toEqual([{reason:'The applied plan does not allow automatic renewal'}])
      const ok=await invoiced()
      await transaction(pool,async c=>expect(await disableAutoRenewIfPlanForbids(c,ok.s.id)).toBe(false))
      expect((await pool.query('SELECT auto_renew_enabled FROM subscriptions WHERE id=$1',[ok.s.id])).rows[0].auto_renew_enabled).toBe(true)
    })
    describe('a failed saved-card payment ends one way, however it is learned',()=>{
      const expectHard=async(f:Invoiced,attempt:any)=>{
        expect((await savedAttempt(f.order)).map(a=>a.status)).toEqual(['failed'])
        expect(await methodStatus(f.method)).toBe('inactive')
        expect((await pool.query('SELECT status FROM renewals WHERE order_id=$1',[f.order])).rows[0].status).toBe('invoiced')
        expect(await noticesOf(f.s.id,'card_charge_failed')).toEqual([{type:'card_charge_failed',subscription_id:f.s.id,invoice_id:expect.any(String),decline:'hard'}])
        expect((await pool.query("SELECT metadata FROM audit_events WHERE subject=$1 AND action='payment.saved_card_declined'",[f.order])).rows.map(r=>[r.metadata.attempt_id,r.metadata.decline])).toEqual([[attempt.id,'hard']])
      }
      it('a lost answer, then the lookup of the redrive shows a stolen card',async()=>{
        const f=await invoiced()
        f.adapter.scriptTokenCharge(f.token,{outcome:'unknown'})
        await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0)))
        const [attempt]=await savedAttempt(f.order)
        failedAtProvider(f,attempt,'DECLINED: STOLEN CARD')
        await stale(attempt.id)
        await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0)))
        expect(f.charge).toHaveBeenCalledTimes(1)
        await expectHard(f,attempt)
      })
      it('the reconciler finds it',async()=>{
        const f=await invoiced()
        f.adapter.scriptTokenCharge(f.token,{outcome:'unknown'})
        await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0)))
        const [attempt]=await savedAttempt(f.order)
        failedAtProvider(f,attempt,'DECLINED: STOLEN CARD')
        await reconcileUnknownAttempts(pool,f.adapter)
        await expectHard(f,attempt)
        await reconcileUnknownAttempts(pool,f.adapter) // a replay changes nothing
        expect(await noticesOf(f.s.id,'card_charge_failed')).toHaveLength(1)
      })
      it('a webhook reports the failure',async()=>{
        const f=await invoiced()
        f.adapter.scriptTokenCharge(f.token,{outcome:'unknown'})
        await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0)))
        const [attempt]=await savedAttempt(f.order)
        const payment=failedAtProvider(f,attempt,'DECLINED: STOLEN CARD')
        await handleProviderEvent(pool,{provider:'simulator',adapter:f.adapter,rawBody:f.adapter.paymentWebhookBody(payment.payment_id),headers:{}})
        await expectHard(f,attempt)
      })
      it('a payment that was pending later fails',async()=>{
        const f=await invoiced()
        await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0)))
        const [attempt]=await savedAttempt(f.order)
        expect(attempt.status).toBe('pending')
        f.adapter.setPaymentStatus(attempt.id,'failed','DECLINED: STOLEN CARD')
        await pool.query("UPDATE payment_attempts SET updated_at=now()-interval '10 seconds' WHERE id=$1",[attempt.id])
        await verifyReturnedAttempt(pool,{attempt_id:attempt.id,customer_id:f.s.customer,adapter:f.adapter})
        await expectHard(f,attempt)
      })
      it('a soft decline found by lookup keeps the card and the schedule',async()=>{
        const f=await invoiced()
        await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0)))
        const [attempt]=await savedAttempt(f.order)
        f.adapter.setPaymentStatus(attempt.id,'failed','INSUFFICIENT FUNDS')
        await pool.query("UPDATE payment_attempts SET updated_at=now()-interval '10 seconds' WHERE id=$1",[attempt.id])
        await verifyReturnedAttempt(pool,{attempt_id:attempt.id,customer_id:f.s.customer,adapter:f.adapter})
        expect(await methodStatus(f.method)).toBe('active')
        expect(await noticesOf(f.s.id,'card_charge_failed')).toEqual([expect.objectContaining({decline:'soft'})])
        await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,1)))
        expect(f.charge).toHaveBeenCalledTimes(2)
      })
    })
    describe('errors thrown by the charge',()=>{
      it.each([new PaymentError('timeout'),new PaymentError('provider_unreachable'),new PaymentError('provider_error','busy',503),new PaymentError('provider_error','slow down',429)])('a transient error (%s) parks the attempt for the lookup',async error=>{
        const f=await invoiced()
        f.charge.mockRejectedValueOnce(error)
        vi.spyOn(console,'error').mockImplementation(()=>{})
        await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0)))
        expect((await savedAttempt(f.order)).map(a=>a.status)).toEqual(['unknown'])
      })
      it.each([new PaymentError('provider_error','bad request',400),new PaymentError('provider_forbidden','nope',401),new PaymentError('invalid_amount'),new Error('bug')])('a permanent error (%s) closes the attempt, shows on the vendor list and tells the customer to pay by hand',async error=>{
        const f=await invoiced()
        f.charge.mockRejectedValueOnce(error)
        vi.spyOn(console,'error').mockImplementation(()=>{})
        await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0)))
        expect((await savedAttempt(f.order)).map(a=>a.status)).toEqual(['failed'])
        expect(await methodStatus(f.method)).toBe('active')
        expect((await pool.query('SELECT status FROM renewals WHERE order_id=$1',[f.order])).rows[0].status).toBe('invoiced')
        expect((await noticesOf(f.s.id,'card_charge_skipped')).map(n=>n.skip_reason)).toEqual(['charge_refused'])
        expect((await attention(pool,true)).items.filter(i=>i.kind==='renewal_failed'&&i.customer_id===f.s.customer)).toEqual([expect.objectContaining({detail:expect.stringContaining('card_charge_refused')})])
        // The schedule still bounds the tries: the next day tries again, four tries at most.
        f.charge.mockRejectedValue(error)
        for(const d of [1,3,5,9])await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,d)))
        expect(await savedAttempt(f.order)).toHaveLength(4)
      })
      it('an invoice below the provider minimum is not charged by card and the customer is told',async()=>{
        const f=await invoiced({},tiny)
        expect(Number((await pool.query('SELECT total_minor FROM invoices WHERE order_id=$1',[f.order])).rows[0].total_minor)).toBeLessThan(100)
        await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0)))
        expect(f.charge).not.toHaveBeenCalled()
        expect((await noticesOf(f.s.id,'card_charge_skipped')).map(n=>n.skip_reason)).toEqual(['amount_below_minimum'])
      })
      it('a charge that never reached the provider is closed shortly after it was sent, so it cannot block the customer\'s own form for an hour',async()=>{
        const f=await invoiced()
        f.adapter.scriptTokenCharge(f.token,{outcome:'unknown'})
        await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0)))
        const [attempt]=await savedAttempt(f.order)
        const form=()=>createPaymentAttempt(pool,{order_id:f.order,customer_id:f.s.customer,adapter:f.adapter,returnOrigin:fixedReturnOrigin('https://liwan.test'),actor:'7',request:{method:'form',save_card:false}})
        await expect(form()).rejects.toMatchObject({code:'payment_in_progress'})
        await reconcileUnknownAttempts(pool,f.adapter)
        expect((await savedAttempt(f.order)).map(a=>a.status)).toEqual(['unknown']) // the provider has no such payment, but the short wait is not over
        await pool.query("UPDATE payment_attempts SET charge_sent_at=now()-interval '11 minutes' WHERE id=$1",[attempt.id])
        await reconcileUnknownAttempts(pool,f.adapter)
        expect((await savedAttempt(f.order)).map(a=>a.status)).toEqual(['failed'])
        expect((await pool.query('SELECT status FROM renewals WHERE order_id=$1',[f.order])).rows[0].status).toBe('invoiced')
        expect((await form()).intent.id).toBeTruthy()
      })
      it('a lost answer sent again with a changed callback finds the payment the provider already holds',async()=>{
        const f=await invoiced()
        f.adapter.scriptTokenCharge(f.token,{outcome:'unknown'})
        await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0)))
        const [attempt]=await savedAttempt(f.order)
        await stale(attempt.id)
        f.adapter.scriptTokenCharge(f.token,{outcome:'used_given_id'}) // the provider refuses the second body (another origin) and holds the first payment
        await chargeSavedCards(pool,{...chargeArgs(f.adapter,dayOf(f.issued,0)),returnOrigin:fixedReturnOrigin('https://other.liwan.test')})
        expect((await savedAttempt(f.order)).map(a=>a.status)).toEqual(['succeeded'])
        expect((await pool.query('SELECT payment_state FROM orders WHERE id=$1',[f.order])).rows[0].payment_state).toBe('paid')
      })
    })
    it('an unusable return origin flags the customer to the vendor when a charge is due, and never stops a pending payment from settling',async()=>{
      const f=await invoiced()
      const broken=async()=>{throw new CommercialHttpError('return_url_forbidden',422)}
      await chargeSavedCards(pool,{...chargeArgs(f.adapter,dayOf(f.issued,0)),returnOrigin:broken})
      expect(f.charge).not.toHaveBeenCalled()
      expect((await pool.query('SELECT billing_blocked_at FROM subscriptions WHERE id=$1',[f.s.id])).rows[0].billing_blocked_at).toBeInstanceOf(Date)
      expect((await attention(pool,true)).items.filter(i=>i.kind==='billing_blocked'&&i.customer_id===f.s.customer)).toHaveLength(1)
      // A charge that was already sent settles without asking for an origin.
      const g=await invoiced()
      await chargeSavedCards(pool,{...chargeArgs(g.adapter,dayOf(g.issued,0)),subscription_id:g.s.id})
      const lookup=vi.spyOn(g.adapter,'lookupPayment')
      await chargeSavedCards(pool,{...chargeArgs(g.adapter,dayOf(g.issued,0)),returnOrigin:broken,subscription_id:g.s.id})
      expect(lookup).toHaveBeenCalledTimes(1)
      expect((await pool.query('SELECT payment_state FROM orders WHERE id=$1',[g.order])).rows[0].payment_state).toBe('paid')
    })
    it('a token that becomes unusable after a soft decline gives the customer one notice: no more automatic tries',async()=>{
      const f=await invoiced()
      f.adapter.scriptTokenCharge(f.token,{outcome:'declined',message:'INSUFFICIENT FUNDS'})
      await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0)))
      f.adapter.scriptTokenCharge(f.token,{outcome:'token_unusable'})
      await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,1)))
      const notices=(await pool.query("SELECT status,payload FROM commercial_outbox WHERE kind='billing.notice' AND payload->>'type'='card_charge_failed' ORDER BY created_at")).rows
      expect(notices.map(n=>[n.status,n.payload.decline])).toEqual([['done','soft'],['pending','hard']])
    })
    it('uses an allow-list of renewal statuses, and does not plan an exhausted renewal again',async()=>{
      const f=await invoiced()
      await pool.query("UPDATE renewals SET status='superseded' WHERE order_id=$1",[f.order])
      await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0)))
      expect(f.charge).not.toHaveBeenCalled()
      await pool.query("UPDATE renewals SET status='invoiced' WHERE order_id=$1",[f.order])
      f.adapter.scriptTokenCharge(f.token,{outcome:'declined',message:'INSUFFICIENT FUNDS'})
      for(const d of [0,1,3,5])await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,d)))
      expect(f.charge).toHaveBeenCalledTimes(4)
      const query=vi.spyOn(pool,'query')
      await chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,9)))
      expect(query).toHaveBeenCalledTimes(1) // only the candidate scan: no transaction, no subscription lock for it
    })
    it('two concurrent charging runs on one subscription send one charge',async()=>{
      const f=await invoiced()
      await Promise.all([chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0))),chargeSavedCards(pool,chargeArgs(f.adapter,dayOf(f.issued,0)))])
      expect(f.charge).toHaveBeenCalledTimes(1)
      expect(await savedAttempt(f.order)).toHaveLength(1)
    })
    it('a charge in flight against a card removal or against switching auto-renew off loses no money and deadlocks nothing',async()=>{
      for(let round=0;round<6;round++){
        const f=await invoiced()
        const remove=()=>removePaymentMethod(pool,f.adapter,{by:'customer',actor:'7',reason:null,customer_id:f.s.customer,payment_method_id:f.method})
        const off=()=>pool.connect().then(async c=>{try{await c.query('BEGIN');await c.query('SELECT id FROM subscriptions WHERE id=$1 FOR UPDATE',[f.s.id]);await disableAutoRenew(c,f.s.id,{actor:'7',reason:'x'});await c.query('COMMIT')}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}})
        const results=await Promise.allSettled([chargeSavedCards(pool,{...chargeArgs(f.adapter,dayOf(f.issued,0)),subscription_id:f.s.id}),round%2?remove():off()])
        for(const r of results)if(r.status==='rejected')expect((r.reason as {code?:string}).code).not.toBe('40P01')
        const attempts=await savedAttempt(f.order)
        // Either the charge went first (a payment is pending or paid) or the card was gone first (no charge, or one the provider refused): the invoice is never charged twice.
        expect(attempts.length).toBeLessThanOrEqual(1)
        expect(f.charge.mock.calls.length).toBeLessThanOrEqual(1)
      }
    })
  })
})
