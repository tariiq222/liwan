import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { migrate } from '../db.js'
import { listBranches, requestedExtraBranches, reserveBranchesForOrder, archiveBranches, activateBranches } from '../commercial/branches.js'
import { getUsage, recordUsage } from '../commercial/usage.js'
import { setup, client, monthly, money } from './commercial-helpers.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { acceptQuote } from '../commercial/orders.js'
import { customerHttp } from '../commercial/customer-http.js'
import { signServiceRequest } from '@webvue/commercial-contracts/server'
import { riyadhDate } from '@webvue/commercial-contracts'

const url = process.env.CONTROL_TEST_DATABASE_URL
if (url) { const p = new URL(url); if (!['127.0.0.1', 'localhost', '::1'].includes(p.hostname) || !/^webvue_control_scratch_[a-z0-9]+$/.test(p.pathname.slice(1))) throw Error('scratch control DB required') }
const suite = url ? describe : describe.skip

suite('commercial branches & usage (B4)', () => {
  let pool: Pool
  const tenant = randomUUID()
  let sub = '', order = ''
  async function newSub(free = 1) {
    const cust = randomUUID(), s = randomUUID(), rev = randomUUID(), t = randomUUID()
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'T','saas','managed',$2,true)", [t, `inv-${t}`])
    await pool.query('INSERT INTO customers(id,name,tenant_id) VALUES($1,$2,$3)', [cust, 'C', t])
    await pool.query("INSERT INTO subscriptions(id,customer_id,tenant_id,state) VALUES($1,$2,$3,'active')", [s, cust, t])
    await pool.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,$3,$4)',
      [rev, s, JSON.stringify({ included_extra_branches: free, entitlement: { features: { 'branches.extra_limit': 8 } } }), randomUUID()])
    await pool.query('UPDATE subscriptions SET applied_revision_id=$2, revision=1 WHERE id=$1', [s, rev])
    await pool.query("INSERT INTO commercial_branches(id,subscription_id,tenant_id,name,kind,billing,state) VALUES($1,$2,$3,'HQ','hq','included','active')", [randomUUID(), s, t])
    return { s, t }
  }
  async function newOrder(s: string) { return randomUUID() }
  const tx = async <T>(f: (c: any) => Promise<T>) => {
    const c = await pool.connect()
    try { await c.query('BEGIN'); const r = await f(c); await c.query('COMMIT'); return r } catch (e) { await c.query('ROLLBACK'); throw e } finally { c.release() }
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 6 })
    await migrate(pool)
  })
  afterAll(async () => { await pool?.end() })

  // orders FK: create a minimal order is complex; branches.order_id references orders, so drop that FK in scratch.
  beforeAll(async () => { await pool.query('ALTER TABLE commercial_branches DROP CONSTRAINT IF EXISTS commercial_branches_order_id_fkey') })

  it('HQ is listed first and not counted; 3 extras with 1 free → 1 free + 2 paid', async () => {
    const { s, t } = await newSub(1); order = randomUUID()
    const created = await tx(c => reserveBranchesForOrder(c, { order_id: order, subscription_id: s, tenant_id: t, adds: [{ name: 'a' }, { name: 'b' }, { name: 'c' }], quoted_paid: 2, operation_id: 'op1' }))
    expect(created.map(b => b.billing)).toEqual(['free_extra', 'paid', 'paid'])
    const sum = await listBranches(pool, s)
    expect(sum).toMatchObject({ total: 4, hq: 1, free_extra_used: 1, free_extra_allowed: 1, paid: 2, limit: 8 })
    expect(sum.items[0].kind).toBe('hq')
    expect(await requestedExtraBranches(pool, { subscription_id: s, add: 2, archive: [created[0].id] })).toBe(4)
    await expect(requestedExtraBranches(pool, { subscription_id: s, add: 0, archive: [sum.items[0].id] })).rejects.toMatchObject({ code: 'branch_not_found' })
  })

  it('quoted_paid mismatch → 409 requote_required and no rows; duplicate name → branch_name_taken', async () => {
    const { s, t } = await newSub(1)
    await expect(tx(c => reserveBranchesForOrder(c, { order_id: randomUUID(), subscription_id: s, tenant_id: t, adds: [{ name: 'x' }, { name: 'y' }], quoted_paid: 0, operation_id: 'o' })))
      .rejects.toMatchObject({ code: 'requote_required', status: 409 })
    expect((await listBranches(pool, s)).total).toBe(1)
    await tx(c => reserveBranchesForOrder(c, { order_id: randomUUID(), subscription_id: s, tenant_id: t, adds: [{ name: 'dup' }], quoted_paid: 0, operation_id: 'o' }))
    await expect(tx(c => reserveBranchesForOrder(c, { order_id: randomUUID(), subscription_id: s, tenant_id: t, adds: [{ name: 'DUP' }], quoted_paid: 1, operation_id: 'o' })))
      .rejects.toMatchObject({ code: 'branch_name_taken', status: 409 })
  })

  it('real concurrency: one free slot, two reservations with quoted_paid=0 → exactly one wins', async () => {
    const { s, t } = await newSub(1)
    const run = (name: string) => tx(async c => {
      await c.query('SELECT id FROM subscriptions WHERE id=$1 FOR UPDATE', [s])
      return reserveBranchesForOrder(c, { order_id: randomUUID(), subscription_id: s, tenant_id: t, adds: [{ name }], quoted_paid: 0, operation_id: 'o' })
    })
    const res = await Promise.allSettled([run('p'), run('q')])
    expect(res.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const rej = res.find(r => r.status === 'rejected') as PromiseRejectedResult
    expect(rej.reason).toMatchObject({ code: 'requote_required', status: 409 })
    expect((await listBranches(pool, s)).free_extra_used).toBe(1)
  })

  it('archive keeps the row; activate binds the odoo company', async () => {
    const { s, t } = await newSub(1); const o = randomUUID()
    const [b1, b2] = await tx(c => reserveBranchesForOrder(c, { order_id: o, subscription_id: s, tenant_id: t, adds: [{ name: 'k' }, { name: 'l' }], quoted_paid: 1, operation_id: 'o' }))
    const act = await tx(c => activateBranches(c, { order_id: o, bindings: [{ branch_id: b1.id, odoo_company_id: 5 }] }))
    expect(act[0]).toMatchObject({ state: 'active', odoo_company_id: 5 })
    await tx(c => archiveBranches(c, { subscription_id: s, ids: [b2.id] }))
    const sum = await listBranches(pool, s)
    expect(sum.total).toBe(3)
    expect(sum.items.find(b => b.id === b2.id)).toMatchObject({ state: 'archived' })
    expect(sum.items.find(b => b.id === b2.id)!.archived_at).not.toBeNull()
    expect(sum.paid).toBe(0)
  })

  it('new order reserves pending extras using target allowances, excluding HQ from paid count', async () => {
    const { version } = await setup(pool), api = client(pool)
    await api('POST','/catalog/releases',{catalog_version:version,reason:'Initial branches regression'})
    const p = await api('POST','/plans',{name:`Initial branches ${randomUUID()}`,audience:{kind:'public'},term_months:12,currency:'SAR',prices:[{cadence:monthly,amount:money(10000)}],platform_limits: { 'users.limit': null, 'storage.limit_mb': null },included_bundle_revision_ids:[],optional_bundle_revision_ids:[],included_extra_branches:1,extra_branch_prices:[{cadence:monthly,amount:money(5000)}],extra_branches_limit:8,policy_revision_id:'6f1c3d8e-0000-4000-8000-000000000001',trial_days:0,grace_days:0,auto_suspend:true,auto_renew_allowed:true})
    const v = await api('POST',`/plans/${p.body.id}/validate`,{edit_revision:1,reason:'Initial branches regression'})
    const plan = (await api('POST',`/plans/${p.body.id}/publish`,{edit_revision:v.body.edit_revision,reason:'Initial branches regression'})).body
    const t=randomUUID(), customer=randomUUID()
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Initial','saas','managed',$2,true)",[t,`inv-${t}`])
    await pool.query("INSERT INTO customers(id,name,tenant_id) VALUES($1,'Initial',$2)",[customer,t])
    const quote=await createQuoteForCustomer(pool,{customer_id:customer,request:{kind:'new',plan_revision_id:plan.id,bundle_revision_ids:[],cadence:monthly,requested_extra_branches:3}})
    const vendor:any={actor_id:'7',kind:'vendor',customer_id:null,tenant_id:null,capabilities:['vendor.subscriptions.manage']}
    const {order}=await acceptQuote(pool,{quote_id:quote.id,expected_subscription_revision:0,idempotency_key:randomUUID()},vendor)
    const pending=await listBranches(pool,order.subscription_id)
    expect(pending.items.map(b=>({name:b.name,billing:b.billing,state:b.state,order:b.order_id})).sort((a,b)=>a.name.localeCompare(b.name))).toEqual([
      {name:'Branch 1',billing:'free_extra',state:'pending',order:order.id},
      {name:'Branch 2',billing:'paid',state:'pending',order:order.id},
      {name:'Branch 3',billing:'paid',state:'pending',order:order.id},
    ])
    await pool.query('UPDATE subscriptions SET applied_revision_id=target_revision_id,target_revision_id=NULL,revision=revision+1 WHERE id=$1',[order.subscription_id])
    await pool.query("INSERT INTO commercial_branches(id,subscription_id,tenant_id,name,kind,billing,state) VALUES($1,$2,$3,'HQ','hq','included','active')",[randomUUID(),order.subscription_id,t])
    await tx(c=>activateBranches(c,{order_id:order.id,bindings:pending.items.map((b,i)=>({branch_id:b.id,odoo_company_id:i+2}))}))
    expect(await listBranches(pool,order.subscription_id)).toMatchObject({total:4,hq:1,free_extra_used:1,free_extra_allowed:1,paid:2})
    const now=new Date()
    const effective=new Date(now.getTime()+86400000).toISOString().slice(0,10)
    const change=await createQuoteForCustomer(pool,{customer_id:customer,request:{kind:'change',plan_revision_id:plan.id,bundle_revision_ids:[],cadence:monthly,requested_extra_branches:3,effective_date:effective}},now)
    expect(change.effective_date).toBe(effective)
    const environment=process.env.NODE_ENV
    try {
      process.env.NODE_ENV='production'
      const production=await createQuoteForCustomer(pool,{customer_id:customer,request:{kind:'change',plan_revision_id:plan.id,bundle_revision_ids:[],cadence:monthly,requested_extra_branches:3,effective_date:effective}},now)
      expect(production.effective_date).toBe(riyadhDate(now))
    } finally { process.env.NODE_ENV=environment }
    const path='/v1/customer/quotes',raw=JSON.stringify({kind:'change',plan_revision_id:plan.id,bundle_revision_ids:[],cadence:monthly,requested_extra_branches:3,effective_date:effective})
    const header=Buffer.from(JSON.stringify({actor_id:'7',kind:'customer',tenant_id:t,capabilities:['subscription.manage']})).toString('base64')
    const config={installationId:'branch-vendor',key:'vendor-test-key-'.repeat(4),customerCommercialIssuer:'branch-customer',customerCommercialServiceKey:'customer-test-key-'.repeat(4),inventoryPath:'',repositoryRoot:'',python:'python3',stateDir:''}
    const signed=signServiceRequest({method:'POST',path,body:`webvue-principal:${header}\n${raw}`,actor:7,issuer:config.customerCommercialIssuer,key:config.customerCommercialServiceKey})
    const result=await customerHttp(pool,config,{method:'POST',path,raw,headers:{...signed,'x-webvue-principal':header}})
    expect(result).toMatchObject({status:201,data:{effective_date:riyadhDate(new Date())}})
  })

  it('usage: unavailable has null metrics (never 0); fresh vs stale by age', async () => {
    const { t } = await newSub(1)
    const u = await getUsage(pool, { tenant_id: t, limits: { users: 10 } })
    expect(u).toMatchObject({ freshness: 'unavailable', observed_at: null })
    expect(u.metrics[0]).toMatchObject({ used: null, limit: 10, reason: 'not_collected' })
    const at = new Date()
    await recordUsage(pool, { tenant_id: t, observed_at: at, metrics: { users: 3 }, source: 'test' })
    expect((await getUsage(pool, { tenant_id: t, limits: { users: 10 }, now: at })).metrics[0]).toMatchObject({ used: 3, reason: null })
    expect((await getUsage(pool, { tenant_id: t, limits: { users: 10 }, now: new Date(at.getTime() + 16 * 60000) })).freshness).toBe('stale')
  })
})
