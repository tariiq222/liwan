import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { signServiceRequest } from '@webvue/commercial-contracts/server'
import { migrate } from '../db.js'
import { createApp } from '../http.js'
import { url } from './commercial-helpers.js'

const suite = url ? describe : describe.skip
suite('signed customer commercial HTTP boundary on PostgreSQL', () => {
  const pool = new Pool({ connectionString: url })
  const config = { installationId:'vendor-security-test', key:'vendor-test-key-'.repeat(4),
    customerCommercialIssuer:'customer-security-test', customerCommercialServiceKey:'customer-test-key-'.repeat(4),
    inventoryPath:'', repositoryRoot:'', python:'python3', stateDir:'' }
  let server: ReturnType<typeof createApp>, origin: string, tenant: string, otherTenant: string, ownInvoice: string, otherInvoice: string, ownCustomer: string, ownSubscription: string
  const savedEnv = { provider: process.env.WEBVUE_PAYMENT_PROVIDER, origins: process.env.WEBVUE_PAYMENT_RETURN_ORIGINS }
  async function fixture() {
    const tenantId=randomUUID(), customer=randomUUID(), subscription=randomUUID(), invoice=randomUUID()
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'HTTP security','saas','managed',$2,false)",[tenantId,`security-${tenantId}`])
    await pool.query("INSERT INTO customers(id,name,tenant_id) VALUES($1,'HTTP customer',$2)",[customer,tenantId])
    await pool.query('INSERT INTO subscriptions(id,customer_id,tenant_id) VALUES($1,$2,$3)',[subscription,customer,tenantId])
    await pool.query(`INSERT INTO invoices(id,customer_id,subscription_id,kind,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end)
      VALUES($1,$2,$3,'initial','SAR',2,100,15,115,'2026-10-01','2026-11-01')`,[invoice,customer,subscription])
    return { tenant:tenantId, invoice, customer, subscription }
  }
  beforeAll(async () => {
    await migrate(pool)
    const own=await fixture(), other=await fixture()
    tenant=own.tenant;ownInvoice=own.invoice;otherInvoice=other.invoice;otherTenant=other.tenant;ownCustomer=own.customer;ownSubscription=own.subscription
    process.env.WEBVUE_PAYMENT_PROVIDER='simulator';process.env.WEBVUE_PAYMENT_RETURN_ORIGINS='https://webvue.test'
    server=createApp(pool,config).listen(0,'127.0.0.1')
    await new Promise<void>(resolve=>server.once('listening',resolve))
    const address=server.address()
    if(!address || typeof address==='string')throw Error('missing address')
    origin=`http://127.0.0.1:${address.port}`
  })
  afterAll(async () => {
    if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end()
    for(const [name,value] of [['WEBVUE_PAYMENT_PROVIDER',savedEnv.provider],['WEBVUE_PAYMENT_RETURN_ORIGINS',savedEnv.origins]] as const){if(value===undefined)delete process.env[name];else process.env[name]=value}
  })
  async function call(path:string, options:{body?:unknown;capabilities?:string[];issuer?:string;badSignature?:boolean;tamperPrincipal?:boolean;tenantId?:string}={}) {
    const method=options.body===undefined?'GET':'POST', raw=options.body===undefined?'':JSON.stringify(options.body)
    const principal={actor_id:'7',kind:'customer',tenant_id:options.tenantId??tenant,capabilities:options.capabilities??['billing.read']}
    const header=Buffer.from(JSON.stringify(principal)).toString('base64')
    const signed=signServiceRequest({method,path,body:`webvue-principal:${header}\n${raw}`,actor:7,
      issuer:options.issuer??config.customerCommercialIssuer,key:options.badSignature?'wrong-test-key-'.repeat(4):config.customerCommercialServiceKey})
    const principalHeader=options.tamperPrincipal?Buffer.from(JSON.stringify({...principal,capabilities:['subscription.manage']})).toString('base64'):header
    return fetch(origin+path,{method,headers:{...signed,'x-webvue-principal':principalHeader,'content-type':'application/json'},body:raw||undefined})
  }
  it('accepts a correctly signed request without vendor credentials',async()=>{
    const response=await call(`/v1/customer/invoices/${ownInvoice}`)
    expect(response.status).toBe(200);expect(await response.json()).toMatchObject({id:ownInvoice})
  })
  it('rejects a bad signature',async()=>{expect((await call('/v1/customer/invoices',{badSignature:true})).status).toBe(401)})
  it('rejects an otherwise valid signature from the wrong issuer',async()=>{expect((await call('/v1/customer/invoices',{issuer:'wrong-issuer'})).status).toBe(401)})
  it('binds the principal header into the signature',async()=>{expect((await call('/v1/customer/invoices',{tamperPrincipal:true})).status).toBe(401)})
  it.each(['customer_id','tenant_id'])('rejects nested caller-controlled %s',async field=>{
    const response=await call('/v1/customer/quotes',{body:{nested:[{[field]:randomUUID()}]},capabilities:['subscription.manage']})
    expect(response.status).toBe(400);expect(await response.json()).toMatchObject({code:'forbidden_field',field})
  })
  it('requires the endpoint capability',async()=>{expect((await call('/v1/customer/invoices',{capabilities:[]})).status).toBe(403)})
  it('resolves a shared web registry tenant id through its enabled binding only',async()=>{
    const slug=`t${tenant.replaceAll('-','')}`
    expect((await call(`/v1/customer/invoices/${ownInvoice}`,{tenantId:slug})).status).toBe(404)
    await pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,false,1)',[tenant,slug,`${slug}.test`,`webvue_scratch_${slug.slice(1)}`])
    expect((await call(`/v1/customer/invoices/${ownInvoice}`,{tenantId:slug})).status).toBe(404)
    await pool.query('UPDATE shared_registry_bindings SET enabled=true,registry_revision=registry_revision+1 WHERE control_tenant_id=$1',[tenant])
    const response=await call(`/v1/customer/invoices/${ownInvoice}`,{tenantId:slug})
    expect(response.status).toBe(200);expect(await response.json()).toMatchObject({id:ownInvoice})
    expect((await call(`/v1/customer/invoices/${otherInvoice}`,{tenantId:slug})).status).toBe(404)
    expect((await call('/v1/customer/invoices',{tenantId:'Not-A-Slug'})).status).toBe(401)
  })
  it('hides another tenant invoice',async()=>{expect((await call(`/v1/customer/invoices/${otherInvoice}`)).status).toBe(404)})
  let revisionNumber = 0
  async function awaitingOrder() {
    const order=randomUUID(), revision=randomUUID(), invoice=randomUUID()
    await pool.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,$3,$4,$5)',[revision,ownSubscription,++revisionNumber,'{}',randomUUID()])
    await pool.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent)
      VALUES($1,$2,$3,'new',$4,$5,'awaiting_payment','not_started',$6,'fixture',11500,'SAR',2)`,[order,ownCustomer,ownSubscription,randomUUID(),revision,randomUUID()])
    await pool.query(`INSERT INTO invoices(id,customer_id,subscription_id,order_id,kind,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end,due_at)
      VALUES($1,$2,$3,$4,'initial','SAR',2,10000,1500,11500,'2026-01-01','2026-02-01',now())`,[invoice,ownCustomer,ownSubscription,order])
    return order
  }
  it('reads one own order, with states only and no idempotency or payment data',async()=>{
    const order=await awaitingOrder()
    const response=await call(`/v1/customer/orders/${order}`,{capabilities:['subscription.read']})
    expect(response.status).toBe(200)
    const body=await response.json() as Record<string,unknown>
    expect(body).toMatchObject({id:order,payment_state:'awaiting_payment',fulfillment_state:'not_started',cancelled:false,due_now:{minor:11500}})
    expect(Object.keys(body).sort()).toEqual(['cancelled','created_at','due_now','fulfillment_state','id','kind','payment_state'])
    await pool.query('UPDATE orders SET cancelled=true WHERE id=$1',[order])
    expect(await (await call(`/v1/customer/orders/${order}`,{capabilities:['subscription.read']})).json()).toMatchObject({cancelled:true})
  })
  it('answers the same 404 for another tenant order, an unknown id and a malformed id',async()=>{
    const order=await awaitingOrder()
    expect((await call(`/v1/customer/orders/${order}`,{capabilities:['subscription.read'],tenantId:otherTenant})).status).toBe(404)
    expect((await call(`/v1/customer/orders/${randomUUID()}`,{capabilities:['subscription.read']})).status).toBe(404)
    expect((await call('/v1/customer/orders/not-a-uuid',{capabilities:['subscription.read']})).status).toBe(404)
    expect((await call(`/v1/customer/orders/${order}`,{capabilities:['billing.read']})).status).toBe(403)
  })
  it('creates a payment attempt from the idempotency key alone and refuses a caller-chosen return path',async()=>{
    const order=await awaitingOrder()
    expect((await call(`/v1/customer/orders/${order}/payment-attempts`,{body:{return_path:'/subscription',idempotency_key:randomUUID()},capabilities:['subscription.manage']})).status).toBe(422)
    const response=await call(`/v1/customer/orders/${order}/payment-attempts`,{body:{idempotency_key:randomUUID()},capabilities:['subscription.manage']})
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({order_id:order,status:'redirected',amount:{minor:11500}})
  })
  // The web server signs a return anonymously: no principal, the tenant bound into the signed body.
  async function paymentReturn(attempt:string, options:{tenantId?:string;headerTenant?:string;key?:string;replay?:Record<string,string>;path?:string}={}) {
    const tenantId=options.tenantId??tenant, path=options.path??`/v1/customer/payment-returns/${attempt}`
    const headers=options.replay??{...signServiceRequest({method:'POST',path,body:`webvue-payment-return:${tenantId}\n`,actor:'anonymous',anonymous:true,
      issuer:config.customerCommercialIssuer,key:options.key??config.customerCommercialServiceKey}),'x-webvue-tenant':options.headerTenant??tenantId}
    return {headers,response:await fetch(origin+path,{method:'POST',headers})}
  }
  it('accepts an anonymous signed payment return and reveals only the order state',async()=>{
    const order=await awaitingOrder()
    const created=await (await call(`/v1/customer/orders/${order}/payment-attempts`,{body:{idempotency_key:randomUUID()},capabilities:['subscription.manage']})).json() as {id:string}
    const {response}=await paymentReturn(created.id)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({order_id:order,payment_state:'awaiting_payment',fulfillment_state:'not_started'})
  })
  it('refuses a payment return signed with the vendor key, a replayed nonce, or a principal signature',async()=>{
    const order=await awaitingOrder()
    const created=await (await call(`/v1/customer/orders/${order}/payment-attempts`,{body:{idempotency_key:randomUUID()},capabilities:['subscription.manage']})).json() as {id:string}
    expect((await paymentReturn(created.id,{key:config.key})).response.status).toBe(401)
    // Signed for tenant A but sent as tenant B: the signed body no longer matches the header.
    expect((await paymentReturn(created.id,{tenantId:tenant,headerTenant:otherTenant})).response.status).toBe(401)
    const first=await paymentReturn(created.id)
    expect(first.response.status).toBe(200)
    expect((await paymentReturn(created.id,{replay:first.headers})).response.status).toBe(401)
    const path=`/v1/customer/payment-returns/${created.id}`
    const principalHeader=Buffer.from(JSON.stringify({actor_id:'7',kind:'customer',tenant_id:tenant,capabilities:['subscription.read']})).toString('base64')
    const signed=signServiceRequest({method:'POST',path,body:`webvue-principal:${principalHeader}\n`,actor:7,issuer:config.customerCommercialIssuer,key:config.customerCommercialServiceKey})
    expect((await fetch(origin+path,{method:'POST',headers:{...signed,'x-webvue-tenant':tenant}})).status).toBe(401)
  })
  it('answers 404 for another customer attempt, an unknown tenant, a malformed id or a wrong method',async()=>{
    const order=await awaitingOrder()
    const created=await (await call(`/v1/customer/orders/${order}/payment-attempts`,{body:{idempotency_key:randomUUID()},capabilities:['subscription.manage']})).json() as {id:string}
    expect((await paymentReturn(created.id,{tenantId:otherTenant})).response.status).toBe(404)
    expect((await paymentReturn(created.id,{tenantId:randomUUID()})).response.status).toBe(404)
    expect((await paymentReturn(randomUUID())).response.status).toBe(404)
    expect((await paymentReturn('not-a-uuid')).response.status).toBe(404)
    const path=`/v1/customer/payment-returns/${created.id}`
    expect((await fetch(origin+path,{method:'GET'})).status).toBe(404)
  })
})
