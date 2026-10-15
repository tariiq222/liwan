import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { url, setup, client, money, monthly } from './commercial-helpers.js'
import { acceptQuote, cancelOrder } from '../commercial/orders.js'
import { getSubscription } from '../commercial/subscriptions.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { createCustomerTerms } from '../commercial/customer-terms.js'
import { routesB } from '../commercial/routes-b.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'
import { createPaymentAttempt, handleProviderEvent } from '../commercial/payments.js'
import { applyReceipt } from '../commercial/fulfillment.js'
import { listBranches } from '../commercial/branches.js'
import { applyDunning } from '../commercial/renewals.js'
const suite = url ? describe : describe.skip
suite('commercial B1 atomic orders', () => {
  const pool = new Pool({ connectionString: url, max: 8 })
  const api = client(pool)
  let plan: any
  const vendor: any = { actor_id: '7', kind: 'vendor', customer_id: null, tenant_id: null, capabilities: ['vendor.subscriptions.manage','vendor.pricing.manage'] }
  const request = () => ({ kind: 'new', plan_revision_id: plan.id, bundle_revision_ids: [], cadence: monthly, requested_extra_branches: 0 })
  async function customer() { const id = randomUUID(); await pool.query('INSERT INTO customers(id,name) VALUES($1,$2)', [id, 'B1 customer']); return id }
  const accept = (q: any, key = randomUUID()) => ({ quote_id: q.id, expected_subscription_revision: q.expected_subscription_revision, idempotency_key: key })
  beforeAll(async () => {
    const { version } = await setup(pool)
    await api('POST','/catalog/releases',{catalog_version: version,reason:'B1 acceptance'})
    const c = await api('POST','/plans',{name:`B1 ${randomUUID()}`,audience:{kind:'public'},term_months:12,currency:'SAR',prices:[{cadence:monthly,amount:money(10000)}],platform_limits: { 'users.limit': null, 'storage.limit_mb': null },included_bundle_revision_ids:[],optional_bundle_revision_ids:[],included_extra_branches:1,extra_branch_prices:[{cadence:monthly,amount:money(5000)}],extra_branches_limit:null,policy_revision_id:'6f1c3d8e-0000-4000-8000-000000000001',trial_days:0,grace_days:0,auto_suspend:true,auto_renew_allowed:true})
    const v = await api('POST',`/plans/${c.body.id}/validate`,{edit_revision:1,reason:'B1 acceptance'})
    plan = (await api('POST',`/plans/${c.body.id}/publish`,{edit_revision:v.body.edit_revision,reason:'B1 acceptance'})).body
  })
  afterAll(async () => pool.end())
  it('two independent PostgreSQL clients accepting revision zero reserve exactly one order', async () => {
    const id = await customer()
    const a = await createQuoteForCustomer(pool,{customer_id:id,request:request()})
    const b = await createQuoteForCustomer(pool,{customer_id:id,request:request()})
    const other = new Pool({ connectionString: url, max: 1 })
    try {
      const results = await Promise.allSettled([acceptQuote(pool,accept(a),vendor),acceptQuote(other,accept(b),vendor)])
      expect(results.filter(r => r.status==='fulfilled')).toHaveLength(1)
      expect((results.find(r => r.status==='rejected') as PromiseRejectedResult).reason).toMatchObject({status:409,code:'revision_conflict'})
      expect((await pool.query('SELECT count(*)::int AS n FROM orders WHERE customer_id=$1',[id])).rows[0].n).toBe(1)
      const view = await getSubscription(pool,id)
      expect(view).toMatchObject({applied:null,revision:1,pending_order:{due_now:{minor:11500},payment_state:'awaiting_payment'}})
      expect(view.target?.id).toBe(view.pending_order?.target_revision_id)
    } finally { await other.end() }
  })
  it('replays an identical key, rejects changed digest, and does not duplicate invoices', async () => {
    const id=await customer(), q=await createQuoteForCustomer(pool,{customer_id:id,request:request()}), input=accept(q)
    const first=await acceptQuote(pool,input,vendor), second=await acceptQuote(pool,input,vendor)
    expect(second).toEqual({order:first.order,replay:true})
    await expect(acceptQuote(pool,{...input,expected_subscription_revision:1},vendor)).rejects.toMatchObject({status:409,code:'idempotency_conflict'})
    expect((await pool.query('SELECT count(*)::int AS n FROM invoices WHERE order_id=$1',[first.order.id])).rows[0].n).toBe(1)
  })
  it.each(['pending', 'failed'] as const)('keeps a %s hosted payment authoritative when a fresh quote precedes its late success', async initialPayment => {
    const id = await customer(), tenant = randomUUID()
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Pending payment','saas','managed',$2,true)", [tenant, `pending-${tenant}`])
    await pool.query('UPDATE customers SET tenant_id=$2 WHERE id=$1', [id, tenant])
    const firstQuote = await createQuoteForCustomer(pool, { customer_id:id, request:request() })
    const input = accept(firstQuote), first = await acceptQuote(pool, input, vendor)
    const adapter = new SimulatorAdapter()
    const attempt = await createPaymentAttempt(pool, { order_id:first.order.id, customer_id:id, adapter, allowedOrigin:'https://nasq.test', return_path:'/subscription' })
    if (initialPayment === 'failed') {
      adapter.settle(attempt.provider_ref, 'failed')
      expect(await handleProviderEvent(pool, {provider:'simulator',adapter,rawBody:adapter.webhookBody(attempt.provider_ref),headers:{}})).toEqual({status:200,outcome:'accepted'})
      expect((await pool.query('SELECT payment_state FROM orders WHERE id=$1', [first.order.id])).rows[0].payment_state).toBe('failed')
      // Failed attempts can still settle later. Existing cancellation cannot resolve
      // this state; accepting a replacement must stay blocked until explicit resolution.
      await expect(cancelOrder(pool, {order_id:first.order.id,principal:vendor,reason:'Customer changed selection',adapter})).rejects.toMatchObject({status:409,code:'order_not_cancellable'})
    }
    const beforeReject = (await pool.query(`SELECT
      (SELECT count(*) FROM invoices WHERE order_id=$1) AS invoices,
      (SELECT count(*) FROM audit_events WHERE subject=$1::text) AS audits,
      (SELECT count(*) FROM commercial_outbox WHERE aggregate_id=$1::text) AS outbox`, [first.order.id])).rows[0]
    const secondQuote = await createQuoteForCustomer(pool, { customer_id:id, request:request() })
    expect(secondQuote.expected_subscription_revision).toBe(1)
    await expect(acceptQuote(pool, accept(secondQuote), vendor)).rejects.toMatchObject({ status:409, code:'subscription_change_pending' })
    expect((await pool.query(`SELECT
      (SELECT count(*) FROM invoices WHERE order_id=$1) AS invoices,
      (SELECT count(*) FROM audit_events WHERE subject=$1::text) AS audits,
      (SELECT count(*) FROM commercial_outbox WHERE aggregate_id=$1::text) AS outbox`, [first.order.id])).rows[0]).toEqual(beforeReject)
    expect(await acceptQuote(pool, input, vendor)).toEqual({ order:{...first.order,payment_state:initialPayment === 'failed' ? 'failed' : 'awaiting_payment'}, replay:true })
    expect(await getSubscription(pool, id)).toMatchObject({ revision:1, target:{id:first.order.target_revision_id}, pending_order:{id:first.order.id} })
    expect((await pool.query('SELECT count(*)::int AS n FROM orders WHERE customer_id=$1', [id])).rows[0].n).toBe(1)
    expect((await pool.query('SELECT count(*)::int AS n FROM subscription_revisions WHERE subscription_id=$1', [first.order.subscription_id])).rows[0].n).toBe(1)

    adapter.settle(attempt.provider_ref, 'succeeded')
    const rawBody = adapter.webhookBody(attempt.provider_ref)
    expect(await handleProviderEvent(pool, { provider:'simulator', adapter, rawBody, headers:{} })).toEqual({ status:200, outcome:'accepted' })
    expect(await handleProviderEvent(pool, { provider:'simulator', adapter, rawBody, headers:{} })).toEqual({ status:200, outcome:'duplicate' })
    expect((await pool.query('SELECT payment_state,fulfillment_state FROM orders WHERE id=$1', [first.order.id])).rows[0]).toEqual({payment_state:'paid',fulfillment_state:'queued'})
    const paidQuote = await createQuoteForCustomer(pool, { customer_id:id, request:request() })
    await expect(acceptQuote(pool, accept(paidQuote), vendor)).rejects.toMatchObject({code:'subscription_change_pending'})
    // Controlled observed receipt boundary; this test runs no physical Odoo adapter.
    await pool.query('INSERT INTO fulfillment_effects(id,order_id,operation_id) VALUES($1,$2,$3)', [randomUUID(), first.order.id, randomUUID()])
    const receipt = { order_id:first.order.id, tenant_id:tenant, target_revision_id:first.order.target_revision_id, observed_entitlement_digest:firstQuote.entitlement_digest, observed_at:new Date().toISOString(), branch_bindings:[], root_company_id:1 }
    expect(await applyReceipt(pool, { order_id:first.order.id, receipt })).toEqual({ applied:true, replay:false })
    expect(await applyReceipt(pool, { order_id:first.order.id, receipt })).toEqual({ applied:true, replay:true })
    expect(await getSubscription(pool, id)).toMatchObject({ applied:{id:first.order.target_revision_id}, target:null, pending_order:null })
    expect((await pool.query('SELECT status FROM invoices WHERE order_id=$1', [first.order.id])).rows).toEqual([{status:'paid'}])
    expect((await pool.query("SELECT count(*)::int AS n FROM commercial_outbox WHERE kind='fulfillment.enqueue' AND aggregate_id=$1", [first.order.id])).rows[0].n).toBe(1)
    const afterApplied = await createQuoteForCustomer(pool, { customer_id:id, request:{...request(),kind:'change'} })
    expect((await acceptQuote(pool, accept(afterApplied), vendor)).replay).toBe(false)
  })
  it('refuses a fresh quote while an unresolved prior order has no subscription target', async () => {
    const id = await customer(), quote = await createQuoteForCustomer(pool, {customer_id:id,request:request()})
    const first = await acceptQuote(pool, accept(quote), vendor)
    // Renewals can remain pending without reserving a distinct subscription target.
    await pool.query('UPDATE subscriptions SET target_revision_id=NULL,revision=revision+1 WHERE id=$1', [first.order.subscription_id])
    const fresh = await createQuoteForCustomer(pool, {customer_id:id,request:request()})
    await expect(acceptQuote(pool, accept(fresh), vendor)).rejects.toMatchObject({status:409,code:'subscription_change_pending'})
  })
  it('allows a new acceptance after explicit cancellation releases the previous target', async () => {
    const id = await customer(), quote = await createQuoteForCustomer(pool, {customer_id:id,request:request()})
    const first = await acceptQuote(pool, accept(quote), vendor)
    const pathname = `/v1/commercial/orders/${first.order.id}/cancel`
    const response = await routesB(pool, { method:'POST',pathname,raw:JSON.stringify({reason:'Customer changed selection'}),issuer:'commercial-test',actor:7,capabilities:vendor.capabilities }, new URL(pathname, 'http://localhost'))
    expect(response).toMatchObject({status:200,data:{id:first.order.id}})
    const view = await getSubscription(pool, id)
    expect(view).toMatchObject({applied:null,target:null,pending_order:null,revision:2})
    const fresh = await createQuoteForCustomer(pool, {customer_id:id,request:{...request(),subscription_id:view.id,expected_subscription_revision:view.revision}})
    expect((await acceptQuote(pool, accept(fresh), vendor)).replay).toBe(false)
  })
  it('releases only canceled-order pending extra branch reservations and permits the same names again', async () => {
    const id = await customer(), req = { ...request(), requested_extra_branches: 2 }
    const first = await acceptQuote(pool, accept(await createQuoteForCustomer(pool, {customer_id:id,request:req})), vendor)
    const hq = randomUUID(), active = randomUUID()
    // Unrelated applied resources must survive even if an inconsistent legacy row
    // associates them with this order. Only unfulfilled extra reservations release.
    await pool.query("INSERT INTO commercial_branches(id,subscription_id,name,kind,billing,state,order_id) VALUES($1,$3,'HQ','hq','included','active',$4),($2,$3,'Existing archived','extra','paid','archived',$4)", [hq, active, first.order.subscription_id, first.order.id])
    expect(await listBranches(pool, first.order.subscription_id)).toMatchObject({free_extra_used:1,paid:1})
    await cancelOrder(pool, {order_id:first.order.id,principal:vendor,reason:'Choose another initial plan'})
    const old = await pool.query('SELECT id,state,archived_at FROM commercial_branches WHERE order_id=$1 ORDER BY name', [first.order.id])
    expect(old.rows.filter(r => ![hq, active].includes(r.id))).toHaveLength(2)
    expect(old.rows.filter(r => ![hq, active].includes(r.id)).every(r => r.state === 'archived' && r.archived_at)).toBe(true)
    expect(old.rows.find(r => r.id === hq)?.state).toBe('active')
    expect(old.rows.find(r => r.id === active)?.archived_at).toBeNull()
    expect(await listBranches(pool, first.order.subscription_id)).toMatchObject({free_extra_used:0,paid:0})
    const view = await getSubscription(pool, id)
    const fresh = await createQuoteForCustomer(pool, {customer_id:id,request:{...req,subscription_id:view.id,expected_subscription_revision:view.revision}})
    const replacement = await acceptQuote(pool, accept(fresh), vendor)
    expect(replacement.order.kind).toBe('new')
    expect(await listBranches(pool, view.id)).toMatchObject({free_extra_used:1,paid:1})
    expect((await pool.query("SELECT name,state FROM commercial_branches WHERE order_id=$1 ORDER BY name", [replacement.order.id])).rows).toEqual([{name:'Branch 1',state:'pending'},{name:'Branch 2',state:'pending'}])
  })
  it('persists the full-cycle price baseline for a replacement initial order', async () => {
    const id = await customer(), first = await acceptQuote(pool, accept(await createQuoteForCustomer(pool, {customer_id:id,request:request()})), vendor)
    await cancelOrder(pool, {order_id:first.order.id,principal:vendor,reason:'Choose another initial plan'})
    const view = await getSubscription(pool, id)
    const fresh = await createQuoteForCustomer(pool, {customer_id:id,request:{...request(),requested_extra_branches:2,subscription_id:view.id,expected_subscription_revision:view.revision}})
    const replacement = await acceptQuote(pool, accept(fresh), vendor)
    const snapshot = (await pool.query('SELECT snapshot FROM subscription_revisions WHERE id=$1', [replacement.order.target_revision_id])).rows[0].snapshot
    expect(snapshot.pricing).toMatchObject({base_minor:10000,branch_unit_minor:5000,paid_extra_branches:1})
  })
  it('voids the canceled purchase invoice without changing its immutable contents or collecting it later', async () => {
    const id = await customer(), first = await acceptQuote(pool, accept(await createQuoteForCustomer(pool, {customer_id:id,request:request()})), vendor)
    const before = (await pool.query('SELECT * FROM invoices WHERE order_id=$1', [first.order.id])).rows[0]
    const lines = (await pool.query('SELECT * FROM invoice_lines WHERE invoice_id=$1 ORDER BY position', [before.id])).rows
    await cancelOrder(pool, {order_id:first.order.id,principal:vendor,reason:'Choose another initial plan'})
    expect((await pool.query('SELECT * FROM invoices WHERE id=$1', [before.id])).rows[0]).toEqual({...before,status:'void'})
    expect((await pool.query('SELECT * FROM invoice_lines WHERE invoice_id=$1 ORDER BY position', [before.id])).rows).toEqual(lines)
    const replacement = await acceptQuote(pool, accept(await createQuoteForCustomer(pool, {customer_id:id,request:request()})), vendor)
    // Controlled SQL receipt boundary; this runs no provider or physical Odoo adapter.
    await pool.query("UPDATE orders SET payment_state='paid',fulfillment_state='applied' WHERE id=$1", [replacement.order.id])
    await pool.query("UPDATE invoices SET status='paid',paid_at=now() WHERE order_id=$1", [replacement.order.id])
    await pool.query("UPDATE subscriptions SET applied_revision_id=target_revision_id,target_revision_id=NULL,state='active',revision=revision+1 WHERE id=$1", [replacement.order.subscription_id])
    await applyDunning(pool, {now:new Date(Date.now()+3*86400000)})
    expect((await pool.query('SELECT state FROM subscriptions WHERE id=$1', [replacement.order.subscription_id])).rows[0].state).toBe('active')
  })
  it('rejects expired quotes and quotes from another customer', async () => {
    const id=await customer()
    const q=await createQuoteForCustomer(pool,{customer_id:id,request:request()},new Date(Date.now()-60*60*1000))
    await expect(acceptQuote(pool,accept(q),vendor)).rejects.toMatchObject({status:422,code:'quote_expired'})
    await expect(acceptQuote(pool,accept(q),{...vendor,kind:'customer',customer_id:await customer(),capabilities:['subscription.manage']})).rejects.toMatchObject({status:404})
  })
  it('draft terms produce an ephemeral preview that cannot be accepted', async () => {
    const id=await customer(), pathname='/v1/commercial/customer-quotes'
    const input={method:'POST',pathname,search:'',issuer:'commercial-test',actor:7,capabilities:vendor.capabilities}
    const result=await routesB(pool,{...input,raw:JSON.stringify({...request(),customer_id:id,terms:{base_price:{cadence:monthly,amount:money(2000)}}})},new URL(pathname,'http://localhost'))
    expect(result).toMatchObject({status:200,data:{preview:true,due_now:{minor:2300}}})
    const preview=result!.data as any
    expect((await pool.query('SELECT id FROM commercial_quotes WHERE id=$1',[preview.id])).rowCount).toBe(0)
    expect((await pool.query('SELECT id FROM customer_terms_revisions WHERE customer_id=$1',[id])).rowCount).toBe(0)
    await expect(acceptQuote(pool,accept(preview),vendor)).rejects.toMatchObject({status:404})
    const persisted=await routesB(pool,{...input,raw:JSON.stringify({...request(),customer_id:id})},new URL(pathname,'http://localhost'))
    expect(persisted!.status).toBe(201)
    expect((await pool.query('SELECT id FROM commercial_quotes WHERE id=$1',[(persisted!.data as any).id])).rowCount).toBe(1)
  })
  it('customer terms only change that customer pricing and are immutable', async () => {
    const a=await customer(),b=await customer()
    const terms=await createCustomerTerms(pool,{customer_id:a,reason:'Negotiated customer pricing',base_price:{cadence:monthly,amount:money(2000)}},vendor)
    const qa=await createQuoteForCustomer(pool,{customer_id:a,request:request()}), qb=await createQuoteForCustomer(pool,{customer_id:b,request:request()})
    expect(qa.due_now.minor).toBe(2300); expect(qb.due_now.minor).toBe(11500)
    await expect(createQuoteForCustomer(pool,{customer_id:b,request:{...request(),terms_revision_id:terms.id}})).rejects.toMatchObject({status:404})
    await expect(pool.query("UPDATE customer_terms_revisions SET reason='Changed' WHERE id=$1",[terms.id])).rejects.toThrow('immutable')
  })
})

// This boundary fixture exercises the real cancellation and transaction code.
// PostgreSQL integration above remains the authority for locking/rollback behavior.
describe('order cancellation provider uncertainty', () => {
  const principal: any = { actor_id: '7', kind: 'vendor', customer_id: null, tenant_id: null, capabilities: ['vendor.subscriptions.manage'] }
  function fixture(attempt: Record<string, unknown> | Record<string, unknown>[], state: Record<string, unknown> = {}) {
    const writes: string[] = [], providerCalls: string[] = []
    const order = { id:'order', customer_id:'customer', subscription_id:'subscription', kind:'new', quote_id:'quote',
      target_revision_id:'11111111-1111-4111-8111-111111111111', expected_applied_revision_id:null, payment_state:'awaiting_payment', fulfillment_state:'not_started',
      cancelled:false, effective_at:null, idempotency_key:'key', request_digest:'digest', due_now_minor:100, currency:'SAR', exponent:2, created_at:'2026-10-04T00:00:00Z', ...state }
    const client = { release() {}, async query(sql: string) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows:[], rowCount:0 }
      if (sql.startsWith('SELECT customer_id,subscription_id FROM orders')) return { rows:[order], rowCount:1 }
      if (sql.startsWith('SELECT * FROM customers')) return { rows:[{id:'customer',tenant_id:'tenant'}], rowCount:1 }
      if (sql.startsWith('SELECT id FROM subscriptions')) return { rows:[{id:'subscription'}], rowCount:1 }
      if (sql.startsWith('SELECT * FROM orders')) return { rows:[order], rowCount:1 }
      if (sql.startsWith('SELECT * FROM payment_attempts')) return { rows:(Array.isArray(attempt)?attempt:[attempt]).map(item=>({id:'attempt',provider:'simulator',mode:'simulator',status:'pending',provider_ref:'ref',...item})), rowCount:1 }
      if (/^(UPDATE|INSERT)/.test(sql)) { writes.push(sql); return { rows:[order],rowCount:1 } }
      throw Error('Unexpected query: '+sql)
    } }
    const pool = { connect:async()=>client } as unknown as Pool
    const adapter: any = { provider:'simulator', mode:'simulator', cancelAttempt:async(ref:string)=>{providerCalls.push(ref)} }
    return { pool, adapter, writes, providerCalls }
  }
  it.each([
    ['unknown status', {status:'unknown'}, 'configured'],
    ['missing reference', {provider_ref:null}, 'configured'],
    ['missing adapter', {}, 'absent'],
    ['unsupported cancellation', {}, 'unsupported'],
  ])('refuses %s before recording cancellation', async (_label, attempt, mode) => {
    const f=fixture(attempt as Record<string,unknown>)
    if(mode==='unsupported') delete f.adapter.cancelAttempt
    await expect(cancelOrder(f.pool,{order_id:'order',principal,reason:'Customer request',adapter:mode==='absent'?undefined:f.adapter})).rejects.toMatchObject({code:'payment_reconciliation_required',status:409})
    expect(f.writes).toEqual([])
    expect(f.providerCalls).toEqual([])
  })
  it('preflights mixed attempts before the first provider effect', async()=>{
    const f=fixture([{}, {id:'uncertain',status:'unknown'}])
    await expect(cancelOrder(f.pool,{order_id:'order',principal,reason:'Customer request',adapter:f.adapter})).rejects.toMatchObject({code:'payment_reconciliation_required'})
    expect(f.providerCalls).toEqual([])
    expect(f.writes).toEqual([])
  })
  it('settles a supported pending attempt only after provider cancellation', async()=>{
    const f=fixture({})
    const result=await cancelOrder(f.pool,{order_id:'order',principal,reason:'Customer request',adapter:f.adapter})
    expect(result).toMatchObject({id:'order',payment_state:'awaiting_payment',fulfillment_state:'not_started'})
    expect(f.providerCalls).toEqual(['ref'])
    expect(f.writes).toHaveLength(6)
  })
  it.each([{payment_state:'paid'}, {fulfillment_state:'applying'}])('refuses an order outside cancellable state %j', async(state)=>{
    const f=fixture({},state)
    await expect(cancelOrder(f.pool,{order_id:'order',principal,reason:'Customer request',adapter:f.adapter})).rejects.toMatchObject({code:'order_not_cancellable'})
    expect(f.providerCalls).toEqual([])
    expect(f.writes).toEqual([])
  })
  it.each([
    {...principal,customer_id:'other'},
    {...principal,kind:'customer',customer_id:'customer',tenant_id:'other',capabilities:['subscription.manage']},
  ])('refuses a principal outside the customer scope', async(scoped)=>{
    const f=fixture({})
    await expect(cancelOrder(f.pool,{order_id:'order',principal:scoped,reason:'Customer request',adapter:f.adapter})).rejects.toMatchObject({code:'not_found'})
    expect(f.writes).toEqual([])
  })
  it('provider mismatch refuses before local settlement', async()=>{
    const f=fixture({provider:'other'})
    await expect(cancelOrder(f.pool,{order_id:'order',principal,reason:'Customer request',adapter:f.adapter})).rejects.toMatchObject({code:'provider_mismatch'})
    expect(f.writes).toEqual([])
  })
  it('provider refusal propagates without local settlement', async()=>{
    const f=fixture({});f.adapter.cancelAttempt=async()=>{throw Error('provider refused')}
    await expect(cancelOrder(f.pool,{order_id:'order',principal,reason:'Customer request',adapter:f.adapter})).rejects.toThrow('provider refused')
    expect(f.writes).toEqual([])
  })
})
