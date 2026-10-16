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
  let server: ReturnType<typeof createApp>, origin: string, tenant: string, ownInvoice: string, otherInvoice: string
  async function fixture() {
    const tenantId=randomUUID(), customer=randomUUID(), subscription=randomUUID(), invoice=randomUUID()
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'HTTP security','saas','managed',$2,false)",[tenantId,`security-${tenantId}`])
    await pool.query("INSERT INTO customers(id,name,tenant_id) VALUES($1,'HTTP customer',$2)",[customer,tenantId])
    await pool.query('INSERT INTO subscriptions(id,customer_id,tenant_id) VALUES($1,$2,$3)',[subscription,customer,tenantId])
    await pool.query(`INSERT INTO invoices(id,customer_id,subscription_id,kind,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end)
      VALUES($1,$2,$3,'initial','SAR',2,100,15,115,'2026-10-01','2026-11-01')`,[invoice,customer,subscription])
    return { tenant:tenantId, invoice }
  }
  beforeAll(async () => {
    await migrate(pool)
    const own=await fixture(), other=await fixture()
    tenant=own.tenant;ownInvoice=own.invoice;otherInvoice=other.invoice
    server=createApp(pool,config).listen(0,'127.0.0.1')
    await new Promise<void>(resolve=>server.once('listening',resolve))
    const address=server.address()
    if(!address || typeof address==='string')throw Error('missing address')
    origin=`http://127.0.0.1:${address.port}`
  })
  afterAll(async () => { if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end() })
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
})
