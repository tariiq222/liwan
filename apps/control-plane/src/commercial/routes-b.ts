import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Pool } from 'pg'
import type { IncomingHttpHeaders } from 'node:http'
import { quoteRequestSchema, acceptQuoteRequestSchema, customerTermsRevisionSchema, type Principal } from '@nasq/commercial-contracts'
import { parseBody, need, type CommercialInput } from './http.js'
import { CommercialHttpError } from './lifecycle.js'
import { createCustomerTerms } from './customer-terms.js'
import { createQuoteForCustomer } from './quotes.js'
import { getSubscription } from './subscriptions.js'
import { acceptQuote, cancelOrder } from './orders.js'
import { listCustomers, customerView } from './customers.js'
import { listInvoices, getInvoice } from './invoices.js'
import { listBranches } from './branches.js'
import { getUsage } from './usage.js'
import { createBranchQuote, needPayment, type PaymentRuntime } from './customer-http.js'
import { createPaymentAttempt, handleProviderEvent, paymentAttemptView } from './payments.js'
import { generateRenewals, applyDunning } from './renewals.js'
import { SimulatorAdapter } from './payment-simulator.js'

export async function paymentEventsHttp(pool: Pool, input: {method:string;pathname:string;raw:string;headers:IncomingHttpHeaders}, runtime?: PaymentRuntime) {
  const hit=/^\/v1\/commercial\/payment-events\/([^/]+)$/.exec(input.pathname)
  if(!hit)return null
  if(input.method!=='POST')throw new CommercialHttpError('not_found',404)
  // This endpoint is intentionally outside vendor auth: the adapter alone verifies raw provider bytes.
  const result=await handleProviderEvent(pool,{provider:hit[1]!,rawBody:input.raw,headers:input.headers,adapter:needPayment(runtime).adapter})
  return {status:result.status,data:result}
}
export async function routesB(pool: Pool, input: CommercialInput, url: URL, runtime?: PaymentRuntime) {
  const path=input.pathname.slice('/v1/commercial'.length),m=input.method
  const principal:Principal={actor_id:String(input.actor),kind:'vendor',customer_id:null,tenant_id:null,capabilities:input.capabilities}
  if(path==='/customers'){
    if(m==='GET'){
      need(input,'vendor.read')
      return {status:200,data:await listCustomers(pool,url)}
    }
    if(m==='POST'){
      // A new customer is the start of plan-based tenant creation: its first order provisions a tenant.
      need(input,'vendor.tenants.manage','vendor.subscriptions.manage')
      const body=parseBody(input.raw,z.strictObject({name:z.string().trim().min(1).max(200),tenant_id:z.uuid().nullable().optional(),admin_name:z.string().trim().min(1).max(120).optional(),admin_login:z.email().max(100).optional()}))
      const r=await pool.query('INSERT INTO customers(id,name,tenant_id,admin_name,admin_login) VALUES($1,$2,$3,$4,$5) RETURNING *',[randomUUID(),body.name,body.tenant_id??null,body.admin_name??null,body.admin_login??null]);return {status:201,data:r.rows[0]}
    }
  }
  const customerDetail=/^\/customers\/([^/]+)$/.exec(path)
  if(m==='GET'&&customerDetail){need(input,'vendor.read');if(!z.uuid().safeParse(customerDetail[1]).success)throw new CommercialHttpError('not_found',404);const customer=(await pool.query('SELECT * FROM customers WHERE id=$1',[customerDetail[1]])).rows[0];if(!customer)throw new CommercialHttpError('not_found',404);return {status:200,data:await customerView(pool,customer)}}
  const subscription=/^\/subscriptions\/([^/]+)(?:\/(branches|usage))?$/.exec(path)
  if(m==='GET'&&subscription){
    need(input,'vendor.read')
    if(!z.uuid().safeParse(subscription[1]).success)throw new CommercialHttpError('not_found',404)
    const row=(await pool.query('SELECT customer_id FROM subscriptions WHERE id=$1',[subscription[1]])).rows[0]
    if(!row)throw new CommercialHttpError('not_found',404)
    const view=await getSubscription(pool,row.customer_id)
    if(subscription[2]==='branches')return {status:200,data:await listBranches(pool,view.id)}
    if(subscription[2]==='usage')return {status:200,data:await getUsage(pool,{tenant_id:view.tenant_id!,limits:Object.fromEntries(Object.entries(view.applied?.entitlement.features??{}).filter(([,v])=>v===null||typeof v==='number')) as Record<string,number|null>})}
    return {status:200,data:view}
  }
  if(m==='POST'&&path==='/customer-terms')return {status:201,data:await createCustomerTerms(pool,parseBody(input.raw,z.unknown()),principal)}
  if(m==='POST'&&path==='/customer-quotes'){
    need(input,'vendor.subscriptions.manage')
    const body=parseBody(input.raw,quoteRequestSchema.extend({customer_id:z.uuid(),terms:customerTermsRevisionSchema.omit({id:true,customer_id:true,reason:true}).optional()}));const {customer_id,terms,...request}=body
    if(terms){
      if(request.terms_revision_id)throw new CommercialHttpError('invalid',422,'terms_revision_id')
      const previewTerms=customerTermsRevisionSchema.parse({...terms,id:randomUUID(),customer_id,reason:'Draft terms preview'})
      const quote=await createQuoteForCustomer(pool,{customer_id,request,previewTerms})
      return {status:200,data:{...quote,preview:true}}
    }
    return {status:201,data:await createQuoteForCustomer(pool,{customer_id,request})}
  }
  if(m==='POST'&&path==='/branch-quotes'){
    need(input,'vendor.subscriptions.manage')
    const body=parseBody(input.raw,z.strictObject({customer_id:z.uuid(),add:z.array(z.strictObject({name:z.string()})).default([]),archive:z.array(z.uuid()).default([])}));const {customer_id,...request}=body
    return {status:201,data:await createBranchQuote(pool,customer_id,JSON.stringify(request))}
  }
  if(m==='POST'&&path==='/orders'){
    need(input,'vendor.subscriptions.manage')
    const body=parseBody(input.raw,acceptQuoteRequestSchema)
    // An order for a customer without a tenant provisions one on fulfilment: that is tenant creation.
    const owner=(await pool.query('SELECT c.tenant_id FROM commercial_quotes q JOIN customers c ON c.id::text=q.customer_id WHERE q.id=$1',[body.quote_id])).rows[0]
    if(owner&&!owner.tenant_id)need(input,'vendor.tenants.manage')
    const result=await acceptQuote(pool,body,principal);return {status:result.replay?200:201,data:result}
  }
  const cancel=/^\/orders\/([^/]+)\/cancel$/.exec(path)
  if(cancel&&m==='POST'){
    need(input,'vendor.subscriptions.manage')
    if(!z.uuid().safeParse(cancel[1]).success)throw new CommercialHttpError('not_found',404)
    const body=parseBody(input.raw,z.strictObject({reason:z.string().trim().min(3).max(1000)}))
    return {status:200,data:await cancelOrder(pool,{order_id:cancel[1]!,principal,reason:body.reason,adapter:runtime?.adapter ?? undefined})}
  }
  if(m==='GET'&&path==='/invoices'){need(input,'vendor.billing.manage');const customer=url.searchParams.get('customer_id');if(customer&&!z.uuid().safeParse(customer).success)throw new CommercialHttpError('invalid',422,'customer_id');return {status:200,data:await listInvoices(pool,{customer_id:customer??undefined})}}
  const invoice=/^\/invoices\/([^/]+)$/.exec(path)
  if(m==='GET'&&invoice){need(input,'vendor.billing.manage');if(!z.uuid().safeParse(invoice[1]).success)throw new CommercialHttpError('not_found',404);const data=await getInvoice(pool,invoice[1]!);if(!data)throw new CommercialHttpError('not_found',404);return {status:200,data}}
  const payment=/^\/orders\/([^/]+)\/payment-attempts$/.exec(path)
  if(payment&&(m==='POST'||m==='GET')){
    need(input,'vendor.billing.manage');if(!z.uuid().safeParse(payment[1]).success)throw new CommercialHttpError('not_found',404)
    const order=(await pool.query('SELECT customer_id FROM orders WHERE id=$1',[payment[1]])).rows[0];if(!order)throw new CommercialHttpError('not_found',404)
    if(m==='GET'){const rows=(await pool.query('SELECT * FROM payment_attempts WHERE order_id=$1 ORDER BY created_at DESC',[payment[1]])).rows;return {status:200,data:{items:rows.map(paymentAttemptView),total:rows.length}}}
    const body=parseBody(input.raw,z.strictObject({return_path:z.string().min(1).max(2048),idempotency_key:z.uuid().optional()}));return {status:201,data:await createPaymentAttempt(pool,{order_id:payment[1]!,customer_id:order.customer_id,return_path:body.return_path,...needPayment(runtime)})}
  }
  const settle=/^\/payment-simulator\/([^/]+)\/settle$/.exec(path)
  if(settle){
    // Never construct a second adapter: use the API process's payment runtime.
    const adapter=runtime?.adapter
    if(m!=='POST'||process.env.NODE_ENV==='production'||!(adapter instanceof SimulatorAdapter))throw new CommercialHttpError('not_found',404)
    need(input,'vendor.billing.manage')
    if(!z.uuid().safeParse(settle[1]).success)throw new CommercialHttpError('not_found',404)
    const body=parseBody(input.raw,z.strictObject({outcome:z.enum(['succeeded','failed','canceled'])}))
    const attempt=(await pool.query('SELECT provider,mode,provider_ref FROM payment_attempts WHERE id=$1',[settle[1]])).rows[0]
    if(!attempt||attempt.provider!=='simulator'||attempt.mode!=='simulator'||!attempt.provider_ref)throw new CommercialHttpError('not_found',404)
    // A process restart loses memory; do not settle a recycled ref for another attempt.
    const known=await adapter.lookupByAttemptId(settle[1]!)
    if(!known||known.provider_ref!==attempt.provider_ref)throw new CommercialHttpError('not_found',404)
    adapter.settle(attempt.provider_ref,body.outcome)
    const result=await handleProviderEvent(pool,{provider:'simulator',rawBody:adapter.webhookBody(attempt.provider_ref),headers:{},adapter})
    return {status:result.status,data:{...result,simulated:true}}
  }
  if(m==='POST'&&path==='/renewals/run'){
    need(input,'vendor.billing.manage');const body=parseBody(input.raw||'{}',z.strictObject({now:z.iso.datetime().optional()}));if(body.now&&process.env.NODE_ENV==='production')throw new CommercialHttpError('forbidden',403)
    const now=body.now?new Date(body.now):new Date(),paymentRuntime=needPayment(runtime)
    const generated=await generateRenewals(pool,{now,...paymentRuntime,return_path:'/subscription/status'});const dunning=await applyDunning(pool,{now});return {status:200,data:{generated,dunning}}
  }
  return null
}
