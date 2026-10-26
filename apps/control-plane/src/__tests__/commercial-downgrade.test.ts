import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import * as orders from '../commercial/orders.js'
import * as settlements from '../commercial/settlements.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { createCustomerTerms } from '../commercial/customer-terms.js'
import { assertDowngradeFitsUsage, getUsage, recordUsage } from '../commercial/usage.js'
import { url, setup, client, money, monthly } from './commercial-helpers.js'

const POLICY='6f1c3d8e-0000-4000-8000-000000000001'
describe('review-fix service exports',()=>{
  it('exports authorized cancellation',()=>expect(orders).toHaveProperty('cancelOrder'))
  it('exports manual refund consumer',()=>expect(settlements).toHaveProperty('processRefundOutbox'))
})
const suite=url?describe:describe.skip
suite('downgrade fail-closed usage guards',()=>{
  const pool=new Pool({connectionString:url,max:5}),api=client(pool)
  const vendor:any={actor_id:'7',kind:'vendor',customer_id:null,tenant_id:null,capabilities:['vendor.subscriptions.manage','vendor.pricing.manage']}
  const now=new Date()
  let plan:any,bundle:any
  const reason='Downgrade regression'
  beforeAll(async()=>{
    const {version}=await setup(pool)
    const release=(await api('POST','/catalog/releases',{catalog_version:version,reason})).body
    const app=release.applications.find((a:any)=>a.features.some((f:any)=>f.key==='projects.max_projects'))
    const b=await api('POST','/bundles',{name:`Projects ${randomUUID()}`,description:'Projects',audience:{kind:'public'},catalog_release_id:release.id,selections:[{app_id:app.id,feature_keys:['pmo.enabled']}],domain_limits:{'projects.max_projects':10},prices:[{cadence:monthly,amount:money(0)}]})
    const bv=await api('POST',`/bundles/${b.body.id}/validate`,{edit_revision:1,reason})
    bundle=(await api('POST',`/bundles/${b.body.id}/publish`,{edit_revision:bv.body.edit_revision,reason})).body
    expect(bundle.status).toBe('published')
    const p=await api('POST','/plans',{name:`Downgrade ${randomUUID()}`,audience:{kind:'public'},term_months:12,currency:'SAR',prices:[{cadence:monthly,amount:money(10000)}],platform_limits:{},included_bundle_revision_ids:[bundle.id],optional_bundle_revision_ids:[],included_extra_branches:0,extra_branch_prices:[{cadence:monthly,amount:money(5000)}],extra_branches_limit:10,included_users:10,included_storage_mb:1024,user_prices:[{cadence:monthly,amount:money(0)}],storage_prices:[{cadence:monthly,amount:money(0)}],policy_revision_id:POLICY,trial_days:0,grace_days:0,auto_suspend:true,auto_renew_allowed:true})
    const pv=await api('POST',`/plans/${p.body.id}/validate`,{edit_revision:1,reason})
    plan=(await api('POST',`/plans/${p.body.id}/publish`,{edit_revision:pv.body.edit_revision,reason})).body
    expect(plan.status).toBe('published')
  })
  afterAll(async()=>pool.end())
  async function fixture(){
    const tenant=randomUUID(),customer=randomUUID()
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Downgrade','saas','managed',$2,true)",[tenant,`inv-${tenant}`])
    await pool.query('INSERT INTO customers(id,name,tenant_id) VALUES($1,$2,$3)',[customer,'Downgrade',tenant])
    const request={kind:'new',plan_revision_id:plan.id,bundle_revision_ids:[],cadence:monthly,requested_extra_branches:0,requested_users:10,requested_storage_mb:1024}
    const q=await createQuoteForCustomer(pool,{customer_id:customer,request},now)
    const {order}=await orders.acceptQuote(pool,{quote_id:q.id,expected_subscription_revision:0,idempotency_key:randomUUID()},vendor)
    await pool.query("UPDATE orders SET payment_state='paid',fulfillment_state='applied' WHERE id=$1",[order.id])
    await pool.query("UPDATE subscriptions SET applied_revision_id=target_revision_id,target_revision_id=NULL,state='active',revision=revision+1 WHERE id=$1",[order.subscription_id])
    return {tenant,customer,subscription:order.subscription_id,request:{...request,kind:'change'}}
  }
  const metrics={'users.limit':1,'projects.max_projects':1,'storage.limit_mb':1,'branches.extra_limit':0}
  const gates:Record<string,string[]>={'users.limit':[],'projects.max_projects':['pmo.enabled'],'storage.limit_mb':[],'branches.extra_limit':[]}
  async function usage(f:any,over:any={},at=now){await recordUsage(pool,{tenant_id:f.tenant,observed_at:at,metrics:{...metrics,...over},limit_gates:gates,source:'regression'})}
  async function target(f:any,field:string,limit:number|null){
    // Metered capacity changes only through a new subscription quantity; terms may still negotiate
    // a domain limit (projects) or the branch limit.
    if(field==='users.limit') return {...f.request,requested_users:limit ?? f.request.requested_users}
    if(field==='storage.limit_mb') return {...f.request,requested_storage_mb:limit ?? f.request.requested_storage_mb}
    const terms=await createCustomerTerms(pool,{customer_id:f.customer,reason,...(field==='branches.extra_limit'?{extra_branches_limit:limit}:{limits:{[field]:limit}})},vendor)
    return {...f.request,terms_revision_id:terms.id}
  }
  it.each([
    ['users.limit','users.limit',3,2],['projects.max_projects','projects.max_projects',3,2],['storage.limit_mb','storage.limit_mb',3,2],
  ] as const)('rejects %s below latest usage with an exact field',async(field,key,used,limit)=>{
    const f=await fixture(),request=await target(f,field,limit)
    await usage(f,{[key]:used})
    await expect(createQuoteForCustomer(pool,{customer_id:f.customer,request},now)).rejects.toMatchObject({status:422,code:'downgrade_below_usage',field})
  })
  it('counts active plus pending extra branches, excluding HQ and archived',async()=>{
    const f=await fixture(),request=await target(f,'branches.extra_limit',1)
    await usage(f)
    for(const [name,kind,state] of [['HQ','hq','active'],['one','extra','active'],['two','extra','pending'],['old','extra','archived']])
      await pool.query('INSERT INTO commercial_branches(id,subscription_id,tenant_id,name,kind,billing,state) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),f.subscription,f.tenant,name,kind,kind==='hq'?'included':'paid',state])
    await expect(createQuoteForCustomer(pool,{customer_id:f.customer,request},now)).rejects.toMatchObject({status:422,code:'downgrade_below_usage',field:'branches.extra_limit'})
  })
  it('checks the branch limit even when it is not lowered, and needs no usage sample for it',async()=>{
    const f=await fixture()
    for(const name of ['one','two','three'])
      await pool.query('INSERT INTO commercial_branches(id,subscription_id,tenant_id,name,kind,billing,state) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),f.subscription,f.tenant,name,'extra','paid','active'])
    const client=await pool.connect()
    try{
      const run=(limit:number)=>assertDowngradeFitsUsage(client,{tenant_id:f.tenant,subscription_id:f.subscription,previous:{'branches.extra_limit':limit},target:{'branches.extra_limit':limit}})
      await expect(run(2)).rejects.toMatchObject({status:422,code:'downgrade_below_usage',field:'branches.extra_limit'})
      await run(3)
    }finally{client.release()}
  })
  it.each(['missing','stale','not_collected','source_unavailable'] as const)('fails closed when lowering with %s usage',async fault=>{
    const f=await fixture(),request=await target(f,'users.limit',2)
    if(fault!=='missing') await usage(f,fault==='not_collected'?{'users.limit':null}:{},fault==='stale'?new Date(now.getTime()-15*60000-1):now)
    if(fault==='source_unavailable') await pool.query("UPDATE usage_snapshots SET freshness='unavailable' WHERE tenant_id=$1",[f.tenant])
    await expect(createQuoteForCustomer(pool,{customer_id:f.customer,request},now)).rejects.toMatchObject({status:409,code:'usage_unavailable',field:'users.limit'})
  })
  it('raising quantities does not require usage; equal usage is allowed',async()=>{
    const f=await fixture()
    expect(await createQuoteForCustomer(pool,{customer_id:f.customer,request:await target(f,'users.limit',20)},now)).toHaveProperty('id')
    await usage(f,{'users.limit':2})
    expect(await createQuoteForCustomer(pool,{customer_id:f.customer,request:await target(f,'users.limit',2)},now)).toHaveProperty('id')
  })
  it.each(['increased','stale'] as const)('acceptance rechecks %s usage transactionally',async fault=>{
    const f=await fixture(),request=await target(f,'users.limit',2)
    await usage(f)
    const q=await createQuoteForCustomer(pool,{customer_id:f.customer,request},now)
    if(fault==='increased') await usage(f,{'users.limit':3},new Date(now.getTime()+1))
    else await pool.query("UPDATE usage_snapshots SET observed_at=now()-interval '16 minutes' WHERE tenant_id=$1",[f.tenant])
    await expect(orders.acceptQuote(pool,{quote_id:q.id,expected_subscription_revision:q.expected_subscription_revision,idempotency_key:randomUUID()},vendor)).rejects.toMatchObject({status:fault==='increased'?422:409,code:fault==='increased'?'downgrade_below_usage':'usage_unavailable'})
    expect((await pool.query('SELECT count(*)::int AS n FROM orders WHERE subscription_id=$1',[f.subscription])).rows[0].n).toBe(1)
    expect((await pool.query('SELECT target_revision_id FROM subscriptions WHERE id=$1',[f.subscription])).rows[0].target_revision_id).toBeNull()
  })
  async function gated(f:any,previous:any,target:any,over:any,withGates=true){
    if(withGates) await usage(f,over); else await recordUsage(pool,{tenant_id:f.tenant,observed_at:now,metrics:{...metrics,...over},source:'regression'})
    const client=await pool.connect()
    try{return await assertDowngradeFitsUsage(client,{tenant_id:f.tenant,subscription_id:f.subscription,previous,target,now})}finally{client.release()}
  }
  it('skips a limit whose app the target closes, even when a sibling gate stays open',async()=>{
    const f=await fixture()
    await gated(f,{'pmo.enabled':true,'meetings.enabled':true,'projects.max_projects':null},{'pmo.enabled':false,'meetings.enabled':true,'projects.max_projects':0},{'projects.max_projects':9})
  })
  it('checks a limit whose app reopens, even when the limit is not lowered',async()=>{
    const f=await fixture()
    await expect(gated(f,{'pmo.enabled':false,'projects.max_projects':0},{'pmo.enabled':true,'projects.max_projects':5},{'projects.max_projects':9})).rejects.toMatchObject({status:422,code:'downgrade_below_usage',field:'projects.max_projects'})
  })
  it('does not check a raised limit of an open app, and needs no usage for it',async()=>{
    const f=await fixture()
    await gated(f,{'pmo.enabled':true,'projects.max_projects':10},{'pmo.enabled':true,'projects.max_projects':20},{'projects.max_projects':25})
    const g=await fixture()
    const client=await pool.connect()
    try{await assertDowngradeFitsUsage(client,{tenant_id:g.tenant,subscription_id:g.subscription,previous:{'pmo.enabled':true,'projects.max_projects':10},target:{'pmo.enabled':true,'projects.max_projects':20},now})}finally{client.release()}
  })
  it('fails closed when a checked key has no stored gates',async()=>{
    const f=await fixture()
    await expect(gated(f,{'pmo.enabled':true,'projects.max_projects':10},{'pmo.enabled':true,'projects.max_projects':5},{'projects.max_projects':1},false)).rejects.toMatchObject({status:409,code:'usage_unavailable',field:'projects.max_projects'})
  })
  it('fails closed on a possible reopen when gates are missing',async()=>{
    const f=await fixture()
    await expect(gated(f,{'pmo.enabled':false,'projects.max_projects':0},{'pmo.enabled':true,'projects.max_projects':5},{'projects.max_projects':9},false)).rejects.toMatchObject({status:409,code:'usage_unavailable',field:'projects.max_projects'})
  })
  it('lets a pure limit raise with no boolean flip pass without gates',async()=>{
    const f=await fixture()
    await gated(f,{'pmo.enabled':true,'projects.max_projects':10},{'pmo.enabled':true,'projects.max_projects':20},{'projects.max_projects':25},false)
  })
  it('usage reports applied policy revision, not subscription revision UUID',async()=>{
    const f=await fixture();await usage(f)
    expect((await getUsage(pool,{tenant_id:f.tenant,limits:{'users.limit':10},now})).policy_revision_id).toBe(POLICY)
  })
})
