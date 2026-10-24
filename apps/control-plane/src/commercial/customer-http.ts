import { z } from 'zod'
import type { Pool } from 'pg'
import type { IncomingHttpHeaders } from 'node:http'
import { quoteRequestSchema, acceptQuoteRequestSchema } from '@webvue/commercial-contracts'
import { verifyServiceRequest } from '@webvue/commercial-contracts/server'
import type { Config } from '../config.js'
import { transaction } from '../db.js'
import { CommercialHttpError } from './lifecycle.js'
import { assertNoCustomerIdentity, parseCustomerPrincipal, requireCapability } from './authorization.js'
import { parseBody } from './http.js'
import { getSubscription } from './subscriptions.js'
import { buildQuote, createQuoteForCustomer } from './quotes.js'
import { acceptQuote } from './orders.js'
import { listInvoices, getInvoice } from './invoices.js'
import { planWire } from './plans.js'
import { bundleWire } from './bundles.js'
import { getRelease } from './catalog-releases.js'
import { listBranches, requestedExtraBranches } from './branches.js'
import { getUsage } from './usage.js'
import { createPaymentAttempt } from './payments.js'
import type { PaymentAdapter } from './payment-adapter.js'
export type PaymentRuntime = {adapter: PaymentAdapter | null; allowedOrigin: string}
export function needPayment(runtime?: PaymentRuntime): {adapter:PaymentAdapter;allowedOrigin:string} {
  if(!runtime?.adapter||!runtime.allowedOrigin)throw new CommercialHttpError('payment_unavailable',503)
  return {adapter:runtime.adapter,allowedOrigin:runtime.allowedOrigin}
}

export type CustomerInput = { method: string; path: string; raw: string; headers: IncomingHttpHeaders }
export async function customerCatalog(pool: Pool, customerId: string) {
  const plans = (await pool.query("SELECT * FROM plan_revisions WHERE status='published' AND available AND (audience_customer_id IS NULL OR audience_customer_id=$1) ORDER BY name,id", [customerId])).rows
  const bundles = (await pool.query("SELECT * FROM bundle_revisions WHERE status='published' AND available AND (audience_customer_id IS NULL OR audience_customer_id=$1) ORDER BY name,id", [customerId])).rows
  const releaseId = bundles[0]?.catalog_release_id ?? (await pool.query('SELECT id FROM catalog_releases ORDER BY created_at DESC,id LIMIT 1')).rows[0]?.id
  return { plans: plans.map(r=>planWire(r)), bundles: bundles.map(r=>bundleWire(r)), release: releaseId ? await getRelease(pool,releaseId) : null }
}
const branchInput = z.strictObject({ add: z.array(z.strictObject({name:z.string().trim().min(1).max(200)})).default([]), archive: z.array(z.uuid()).default([]) })
export async function createBranchQuote(pool: Pool, customerId: string, raw: string) {
  const input = parseBody(raw,branchInput)
  if (input.add.length && input.archive.length) throw new CommercialHttpError('mixed_branch_change_unsupported',422)
  const view = await getSubscription(pool,customerId)
  if (!view.applied) throw new CommercialHttpError('subscription_required',409)
  const current = view.applied
  const count = await requestedExtraBranches(pool,{subscription_id:view.id,add:input.add.length,archive:input.archive})
  const limits = current.entitlement.features
  const quote = await createQuoteForCustomer(pool,{customer_id:customerId,request:{kind:'change',plan_revision_id:current.plan_revision_id,bundle_revision_ids:current.bundle_revision_ids,terms_revision_id:current.terms_revision_id,cadence:current.cadence,requested_extra_branches:count,requested_users:Number(limits['users.limit'] ?? 0),requested_storage_mb:Number(limits['storage.limit_mb'] ?? 0),expected_subscription_revision:view.revision}})
  await pool.query('INSERT INTO branch_quote_requests(quote_id,subscription_id,adds,archive,quoted_paid) VALUES($1,$2,$3,$4,$5)',[quote.id,view.id,JSON.stringify(input.add),JSON.stringify(input.archive),Math.max(0,count-current.included_extra_branches)])
  return quote
}
export async function customerHttp(pool: Pool, config: Config, input: CustomerInput, runtime?: PaymentRuntime) {
  const url = new URL(input.path,'http://localhost')
  if (!url.pathname.startsWith('/v1/customer/')) return null
  if (!config.customerCommercialIssuer || !config.customerCommercialServiceKey) throw new CommercialHttpError('not_found',404)
  if (config.customerCommercialServiceKey === config.key || config.customerCommercialIssuer === config.installationId) throw new CommercialHttpError('not_found',404)
  const header=input.headers['x-webvue-principal']
  if (typeof header !== 'string') throw new CommercialHttpError('unauthorized',401)
  const signed=verifyServiceRequest({method:input.method,path:input.path,body:`webvue-principal:${header}\n${input.raw}`,headers:input.headers,key:config.customerCommercialServiceKey})
  if (!signed || signed.issuer !== config.customerCommercialIssuer) throw new CommercialHttpError('unauthorized',401)
  const unbound=parseCustomerPrincipal(header,'unbound')
  if (unbound.actor_id !== String(signed.actor)) throw new CommercialHttpError('unauthorized',401)
  const principal=await transaction(pool,async client=>{
    await client.query('DELETE FROM service_nonces WHERE expires_at<now()')
    const nonce=await client.query("INSERT INTO service_nonces(issuer,nonce,expires_at) VALUES($1,$2,now()+interval '60 seconds') ON CONFLICT DO NOTHING RETURNING nonce",[signed.issuer,signed.nonce])
    if (!nonce.rowCount) throw new CommercialHttpError('unauthorized',401)
    // A shared web signs the registry tenant id; the enabled binding maps it to the control tenant.
    const tenantId=z.uuid().safeParse(unbound.tenant_id).success?unbound.tenant_id:
      (await client.query('SELECT control_tenant_id FROM shared_registry_bindings WHERE tenant_id=$1 AND enabled=true',[unbound.tenant_id])).rows[0]?.control_tenant_id
    if (!tenantId) throw new CommercialHttpError('not_found',404)
    const customer=await client.query('SELECT id FROM customers WHERE tenant_id=$1',[tenantId])
    if (!customer.rowCount) throw new CommercialHttpError('not_found',404)
    return {...parseCustomerPrincipal(header,customer.rows[0].id),tenant_id:tenantId as string}
  })
  assertNoCustomerIdentity(Object.fromEntries(url.searchParams))
  if(input.raw) { let body:unknown; try{body=JSON.parse(input.raw)}catch{throw new CommercialHttpError('invalid',400,'body')} assertNoCustomerIdentity(body) }
  const path=url.pathname.slice('/v1/customer'.length),m=input.method,customerId=principal.customer_id!
  if (m==='GET' && path==='/subscription') {requireCapability(principal,'subscription.read');return {status:200,data:await getSubscription(pool,customerId)}}
  if (m==='GET' && path==='/catalog') {requireCapability(principal,'subscription.read');return {status:200,data:await customerCatalog(pool,customerId)}}
  if (m==='POST' && path==='/quotes') {requireCapability(principal,'subscription.manage');return {status:201,data:await createQuoteForCustomer(pool,{customer_id:customerId,request:{...parseBody(input.raw,quoteRequestSchema),effective_date:undefined}})}}
  if (m==='POST' && path==='/preview') {requireCapability(principal,'subscription.read');return {status:200,data:await buildQuote(pool,{customer_id:customerId,request:parseBody(input.raw,quoteRequestSchema)})}}
  if (m==='POST' && path==='/orders') {requireCapability(principal,'subscription.manage');const result=await acceptQuote(pool,parseBody(input.raw,acceptQuoteRequestSchema),principal);return {status:result.replay?200:201,data:result}}
  const payment=/^\/orders\/([^/]+)\/payment-attempts$/.exec(path)
  if(m==='POST'&&payment){
    requireCapability(principal,'subscription.manage')
    if(!z.uuid().safeParse(payment[1]).success || !(await pool.query('SELECT id FROM orders WHERE id=$1 AND customer_id=$2',[payment[1],customerId])).rowCount)throw new CommercialHttpError('not_found',404)
    const body=parseBody(input.raw,z.strictObject({return_path:z.string().min(1).max(2048),idempotency_key:z.uuid()}))
    return {status:201,data:await createPaymentAttempt(pool,{order_id:payment[1]!,customer_id:customerId,return_path:body.return_path,...needPayment(runtime)})}
  }
  if(m==='GET'&&path==='/invoices'){requireCapability(principal,'billing.read');return {status:200,data:await listInvoices(pool,{customer_id:customerId})}}
  const invoice=/^\/invoices\/([^/]+)$/.exec(path)
  if(m==='GET'&&invoice){requireCapability(principal,'billing.read');if(!z.uuid().safeParse(invoice[1]).success)throw new CommercialHttpError('not_found',404);const data=await getInvoice(pool,invoice[1]!,{customer_id:customerId});if(!data)throw new CommercialHttpError('not_found',404);return {status:200,data}}
  if(m==='GET'&&path==='/branches'){requireCapability(principal,'subscription.read');const view=await getSubscription(pool,customerId);return {status:200,data:await listBranches(pool,view.id)}}
  if(m==='POST'&&path==='/branch-quotes'){requireCapability(principal,'branches.manage');return {status:201,data:await createBranchQuote(pool,customerId,input.raw)}}
  if(m==='GET'&&path==='/usage'){requireCapability(principal,'subscription.read');const view=await getSubscription(pool,customerId);const features=view.applied?.entitlement.features??{};const limits=Object.fromEntries(Object.entries(features).filter(([,v])=>v===null||typeof v==='number')) as Record<string,number|null>;return {status:200,data:await getUsage(pool,{tenant_id:principal.tenant_id!,limits})}}
  if(m==='POST'&&path==='/auto-renew'){
    requireCapability(principal,'subscription.manage')
    const body=parseBody(input.raw,z.strictObject({enabled:z.boolean(),consent:z.boolean().optional()}))
    await transaction(pool,async client=>{
      const r=await client.query('SELECT * FROM subscriptions WHERE customer_id=$1 FOR UPDATE',[customerId]);if(!r.rowCount)throw new CommercialHttpError('not_found',404)
      const s=r.rows[0];if(body.enabled&&(!body.consent||!s.provider_token_ref))throw new CommercialHttpError('token_required',409)
      if(s.auto_renew_enabled===body.enabled)return
      await client.query('UPDATE subscriptions SET auto_renew_enabled=$1,auto_renew_consent_at=CASE WHEN $1 THEN now() ELSE auto_renew_consent_at END,revision=revision+1 WHERE id=$2',[body.enabled,s.id])
    })
    return {status:200,data:await getSubscription(pool,customerId)}
  }
  throw new CommercialHttpError('not_found',404)
}
