import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { actorName } from '../admin-auth/accounts.js'
import type { Pool } from 'pg'
import type { IncomingHttpHeaders } from 'node:http'
import { quoteRequestSchema, acceptQuoteRequestSchema, customerTermsRevisionSchema, invoiceStatusSchema, refundCreditNoteRequestSchema, type Principal } from '@liwan/commercial-contracts'
import { parseBody, need, type CommercialInput } from './http.js'
import { CommercialHttpError, digestOf } from './lifecycle.js'
import { createCustomerTerms } from './customer-terms.js'
import { createQuoteForCustomer } from './quotes.js'
import { getSubscription } from './subscriptions.js'
import { acceptQuote, cancelOrder } from './orders.js'
import { listCustomers, customerView } from './customers.js'
import { attention } from './attention.js'
import { listClients } from './clients.js'
import { listVendorInvoices, getVendorInvoice } from './invoices.js'
import { analyticsFromQuery } from './analytics.js'
import { listBranches } from './branches.js'
import { getUsage } from './usage.js'
import { createBranchQuote, needPayment, type PaymentRuntime } from './customer-http.js'
import { endTrial, extendTrial, startTrial } from './trial.js'
import { createPaymentAttempt, handleProviderEvent, paymentAttemptView } from './payments.js'
import { generateRenewals, applyDunning } from './renewals.js'
import { SimulatorAdapter } from './payment-simulator.js'
import { refundCreditNote } from './settlements.js'

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
  const principal:Principal={actor_id:actorName({id:input.actor}),kind:'vendor',customer_id:null,tenant_id:null,capabilities:input.capabilities}
  if(path==='/customers'){
    if(m==='GET'){
      need(input,'vendor.read')
      return {status:200,data:await listCustomers(pool,url)}
    }
    if(m==='POST'){
      // A new customer is the start of plan-based tenant creation: its first order provisions a tenant.
      need(input,'vendor.tenants.manage','vendor.subscriptions.manage')
      const body=parseBody(input.raw,z.strictObject({name:z.string().trim().min(1).max(200),tenant_id:z.uuid().nullable().optional(),admin_name:z.string().trim().min(1).max(120).optional(),admin_login:z.email().max(100).optional(),request_id:z.uuid().optional()}))
      const {request_id:requestId,...fields}=body
      // A retried creation (double submit, lost response, replay) with the same request_id returns the
      // original customer; the same id with a different body is an idempotency conflict, as for orders.
      const digest=requestId?digestOf(fields):null
      const r=await pool.query('INSERT INTO customers(id,name,tenant_id,admin_name,admin_login,creation_request_id,creation_digest) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (creation_request_id) DO NOTHING RETURNING *',[randomUUID(),fields.name,fields.tenant_id??null,fields.admin_name??null,fields.admin_login??null,requestId??null,digest])
      if(r.rowCount)return {status:201,data:r.rows[0]}
      const existing=(await pool.query('SELECT * FROM customers WHERE creation_request_id=$1',[requestId])).rows[0]
      if(!existing||existing.creation_digest!==digest)throw new CommercialHttpError('idempotency_conflict',409)
      return {status:200,data:existing}
    }
  }
  if(path==='/attention'&&m==='GET'){need(input,'vendor.read');return {status:200,data:await attention(pool,input.capabilities.includes('vendor.billing.manage'))}}
  if(path==='/clients'&&m==='GET'){need(input,'vendor.read');return {status:200,data:await listClients(pool,url)}}
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
  const startTrialPath=/^\/customers\/([^/]+)\/trial$/.exec(path)
  if(m==='POST'&&startTrialPath){
    need(input,'vendor.subscriptions.manage')
    if(!z.uuid().safeParse(startTrialPath[1]).success)throw new CommercialHttpError('not_found',404)
    const owner=(await pool.query('SELECT tenant_id FROM customers WHERE id=$1',[startTrialPath[1]])).rows[0]
    if(!owner)throw new CommercialHttpError('not_found',404)
    // The trial's order provisions the tenant of a customer that has none yet: that is tenant creation.
    if(!owner.tenant_id)need(input,'vendor.tenants.manage')
    const result=await startTrial(pool,{customer_id:startTrialPath[1],request:parseBody(input.raw,quoteRequestSchema.omit({subscription_id:true})),principal})
    return {status:result.replay?200:201,data:result}
  }
  const trial=/^\/trials\/([^/]+)\/(extend|end)$/.exec(path)
  if(m==='POST'&&trial){
    need(input,'vendor.subscriptions.manage')
    if(!input.stepUpFresh)throw new CommercialHttpError('step_up_required',403)
    if(!z.uuid().safeParse(trial[1]).success)throw new CommercialHttpError('not_found',404)
    if(trial[2]==='extend'){
      const body=parseBody(input.raw,z.strictObject({days:z.number().int().min(1).max(365),reason:z.string().trim().min(3).max(1000)}))
      return {status:200,data:await extendTrial(pool,{subscription_id:trial[1],days:body.days,reason:body.reason,actor:principal.actor_id})}
    }
    const body=parseBody(input.raw,z.strictObject({reason:z.string().trim().min(3).max(1000)}))
    const payment=needPayment(runtime)
    return {status:200,data:await endTrial(pool,{subscription_id:trial[1],reason:body.reason,actor:principal.actor_id,now:new Date(),adapter:payment.adapter,returnOrigin:payment.returnOrigin})}
  }
  if(m==='POST'&&path==='/customer-terms'){need(input,'vendor.pricing.manage','vendor.subscriptions.manage');return {status:201,data:await createCustomerTerms(pool,parseBody(input.raw,z.unknown()),principal)}}
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
  if(m==='GET'&&path==='/invoices'){need(input,'vendor.billing.manage');const customer=url.searchParams.get('customer_id');if(customer&&!z.uuid().safeParse(customer).success)throw new CommercialHttpError('invalid',422,'customer_id');const status=url.searchParams.get('status');if(status&&!invoiceStatusSchema.safeParse(status).success)throw new CommercialHttpError('invalid',422,'status');const page=(f:string,d:number,max:number)=>{const raw=url.searchParams.get(f);if(raw===null)return d;if(!/^\d+$/.test(raw)||Number(raw)>max)throw new CommercialHttpError('invalid',422,f);return Number(raw)};const limit=page('limit',50,200);if(limit<1)throw new CommercialHttpError('invalid',422,'limit');return {status:200,data:await listVendorInvoices(pool,{customer_id:customer??undefined,status:status??undefined,limit,offset:page('offset',0,Number.MAX_SAFE_INTEGER)})}}
  if(m==='GET'&&path==='/analytics'){need(input,'vendor.billing.manage');return {status:200,data:await analyticsFromQuery(pool,url)}}
  const invoice=/^\/invoices\/([^/]+)$/.exec(path)
  if(m==='GET'&&invoice){need(input,'vendor.billing.manage');if(!z.uuid().safeParse(invoice[1]).success)throw new CommercialHttpError('not_found',404);const data=await getVendorInvoice(pool,invoice[1]!);if(!data)throw new CommercialHttpError('not_found',404);return {status:200,data}}
  const payment=/^\/orders\/([^/]+)\/payment-attempts$/.exec(path)
  if(payment&&(m==='POST'||m==='GET')){
    need(input,'vendor.billing.manage');if(!z.uuid().safeParse(payment[1]).success)throw new CommercialHttpError('not_found',404)
    const order=(await pool.query('SELECT customer_id FROM orders WHERE id=$1',[payment[1]])).rows[0];if(!order)throw new CommercialHttpError('not_found',404)
    if(m==='GET'){const rows=(await pool.query('SELECT * FROM payment_attempts WHERE order_id=$1 ORDER BY created_at DESC',[payment[1]])).rows;return {status:200,data:{items:rows.map(paymentAttemptView),total:rows.length}}}
    parseBody(input.raw||'{}',z.strictObject({idempotency_key:z.uuid().optional()}));return {status:201,data:await createPaymentAttempt(pool,{order_id:payment[1]!,customer_id:order.customer_id,...needPayment(runtime)})}
  }
  const refund=/^\/invoice-adjustments\/([^/]+)\/refund$/.exec(path)
  if(refund&&m==='POST'){
    need(input,'vendor.billing.manage')
    if(!z.uuid().safeParse(refund[1]).success)throw new CommercialHttpError('not_found',404)
    return {status:200,data:await refundCreditNote(pool,{adjustment_id:refund[1]!,actor:{issuer:input.issuer,actorUid:input.actor},request:parseBody(input.raw,refundCreditNoteRequestSchema)})}
  }
  const settle=/^\/payment-simulator\/([^/]+)\/settle$/.exec(path)
  if(settle){
    // Never construct a second adapter: use the API process's payment runtime.
    const adapter=runtime?.adapter
    if(m!=='POST'||process.env.NODE_ENV==='production'||!(adapter instanceof SimulatorAdapter))throw new CommercialHttpError('not_found',404)
    need(input,'vendor.billing.manage')
    if(!z.uuid().safeParse(settle[1]).success)throw new CommercialHttpError('not_found',404)
    const body=parseBody(input.raw,z.strictObject({outcome:z.enum(['succeeded','failed','canceled'])}))
    const attempt=(await pool.query('SELECT id,order_id,provider,mode,provider_ref,amount_minor,currency,exponent FROM payment_attempts WHERE id=$1',[settle[1]])).rows[0]
    if(!attempt||attempt.provider!=='simulator'||attempt.mode!=='simulator'||!attempt.provider_ref)throw new CommercialHttpError('not_found',404)
    // A process restart loses memory: re-adopt this attempt's own simulator ref, never a recycled or foreign one.
    if(!adapter.adopt(attempt))throw new CommercialHttpError('not_found',404)
    const known=await adapter.lookupByAttemptId(settle[1]!)
    if(!known||known.provider_ref!==attempt.provider_ref)throw new CommercialHttpError('not_found',404)
    adapter.settle(attempt.provider_ref,body.outcome)
    const result=await handleProviderEvent(pool,{provider:'simulator',rawBody:adapter.webhookBody(attempt.provider_ref),headers:{},adapter})
    return {status:result.status,data:{...result,simulated:true}}
  }
  if(m==='POST'&&path==='/renewals/run'){
    need(input,'vendor.billing.manage');const body=parseBody(input.raw||'{}',z.strictObject({now:z.iso.datetime().optional()}));if(body.now&&process.env.NODE_ENV==='production')throw new CommercialHttpError('forbidden',403)
    const now=body.now?new Date(body.now):new Date(),paymentRuntime=needPayment(runtime)
    const generated=await generateRenewals(pool,{now,...paymentRuntime});const dunning=await applyDunning(pool,{now});return {status:200,data:{generated,dunning}}
  }
  return null
}
