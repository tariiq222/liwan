import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { transaction } from '../db.js'
import { nextOrderState, type EffectReceipt } from '@webvue/commercial-contracts'
import { activateBranches, archiveBranches, listBranches } from './branches.js'
import { claimOutbox, completeOutbox, failOutbox } from './outbox.js'
import { recordFulfillmentFailure } from './settlements.js'
import { enqueueReconfigureJob } from '../shared/job-store.js'
import type { Config } from '../config.js'
import type { RegistryActor } from '../shared/registry-store.js'
import { onboardSharedTenant } from '../shared/onboarding.js'
import { commercialEnrollmentActor } from '../shared/commercial-enrollment-authority.js'
import { enqueueOutbox } from './outbox.js'

/** The Odoo hard expiry: trial end plus the plan's grace, on the UTC calendar Odoo compares. */
export function commercialExpiryDate(trialEndsAt: string | Date, graceDays: number): string {
  const end = new Date(trialEndsAt)
  end.setUTCDate(end.getUTCDate() + graceDays)
  return end.toISOString().slice(0, 10)
}

export async function commercialValidUntil(client: Pool | PoolClient, order: Record<string, any>): Promise<string | null> {
  if (order.kind !== 'new' || order.payment_state !== 'not_required' || !order.trial_ends_at) return null
  const plan = await client.query('SELECT grace_days FROM plan_revisions WHERE id=$1', [order.snapshot.plan_revision_id])
  return commercialExpiryDate(order.trial_ends_at, Number(plan.rows[0]?.grace_days ?? 0))
}

/** The immutable authority sent to Odoo; operation_id survives worker retries. */
export type FulfillmentAuthority = {
  order_id: string
  operation_id: string
  previous_revision_id: string | null
  target_revision_id: string
  entitlement: { modules: string[]; features: Record<string, unknown>; digest: string; compiler_version: string }
  branches: { apply: { branch_id: string; name: string }[]; archive: string[] }
  commercial_valid_until: string | null
}
export type SubscriptionReceipt = EffectReceipt & { database?: string; modules_installed?: string[]; root_company_id?: number; archived_branch_ids?: string[]; roles_not_granted?: boolean; roles_not_granted_reason?: 'no_admin_login' | 'admin_not_found' | 'roles_missing' }

/** Receipt application is atomic with branch activation and the commercial revision. */
export async function applyReceipt(pool: Pool, input: { order_id: string; receipt: SubscriptionReceipt }) {
  try { return await transaction(pool, async client => {
    const result = await client.query(`SELECT o.*,s.tenant_id,s.applied_revision_id,s.target_revision_id AS subscription_target,
      r.snapshot FROM orders o JOIN subscriptions s ON s.id=o.subscription_id
      JOIN subscription_revisions r ON r.id=o.target_revision_id WHERE o.id=$1 FOR UPDATE OF o,s`, [input.order_id])
    const order = result.rows[0]
    if (!order) throw new Error('order_not_found')
    if (!order.tenant_id) throw new Error('tenant_required')
    const receipt = input.receipt
    if (receipt.order_id !== order.id || receipt.target_revision_id !== order.target_revision_id || receipt.observed_entitlement_digest !== order.snapshot.entitlement.digest) throw new Error('observed_mismatch')
    if (order.fulfillment_state === 'applied') return { applied: true, replay: true }
    if (order.subscription_target !== order.target_revision_id && !(order.kind==='renewal' && !order.subscription_target && order.applied_revision_id===order.target_revision_id)) throw new Error('stale_target')
    // A recovered receipt may arrive before a worker persisted its started state.
    const started = order.fulfillment_state === 'queued' ? nextOrderState(order, { type: 'fulfillment_started' }) : order
    const next = nextOrderState(started, { type: 'fulfillment_applied', receipt, target_revision_id: order.target_revision_id })
    await client.query('UPDATE orders SET fulfillment_state=$2 WHERE id=$1', [order.id, next.fulfillment_state])
    await client.query(`UPDATE subscriptions SET applied_revision_id=$2,target_revision_id=NULL,
      state=CASE WHEN $3='change' THEN 'active' WHEN trial_ends_at>now() THEN 'trialing' ELSE 'active' END,
      trial_ends_at=CASE WHEN $3 IN ('renewal','change') THEN NULL ELSE trial_ends_at END,
      renewal_at=CASE WHEN applied_revision_id IS NULL OR $3='renewal' THEN COALESCE((SELECT period_end FROM renewals WHERE order_id=$5),$4::date,renewal_at) ELSE renewal_at END,
      revision=revision+1 WHERE id=$1`, [order.subscription_id, order.target_revision_id, order.kind, order.snapshot.period_end??null, order.id])
    if(!order.applied_revision_id){
      // The HQ branch is the tenant's root company; a first activation without it is an incomplete observation.
      if(!Number.isSafeInteger(receipt.root_company_id) || receipt.root_company_id!<1)throw Error('observed_mismatch')
      await client.query(`INSERT INTO commercial_branches(id,subscription_id,tenant_id,name,kind,billing,state,odoo_company_id,order_id,activated_at)
        VALUES($1,$2,$3,'المقر الرئيسي','hq','included','active',$4,$5,now()) ON CONFLICT DO NOTHING`,
        [randomUUID(),order.subscription_id,order.tenant_id,receipt.root_company_id,order.id])
      await enqueueOutbox(client,{kind:'invitation.issue',aggregate_id:order.subscription_id,dedupe_key:'first-activation',payload:{subscription_id:order.subscription_id}})
    }
    await activateBranches(client, { order_id: order.id, bindings: receipt.branch_bindings })
    await archiveBranches(client,{subscription_id:order.subscription_id,ids:order.snapshot.branch_archive_ids??order.snapshot.branches?.archive??[]})
    const effect=await client.query('SELECT operation_id FROM fulfillment_effects WHERE order_id=$1',[order.id])
    if(!effect.rowCount)throw Error('fulfillment_operation_missing')
    await client.query(`INSERT INTO fulfillment_effects(id,order_id,operation_id,receipt,observed_digest,applied_at)
      VALUES($1,$2,$3,$4,$5,now()) ON CONFLICT(order_id) DO UPDATE SET receipt=EXCLUDED.receipt,observed_digest=EXCLUDED.observed_digest,applied_at=EXCLUDED.applied_at`,
    [randomUUID(), order.id, effect.rows[0].operation_id, receipt, receipt.observed_entitlement_digest])
    return { applied: true, replay: false }
  }) } catch(error) {
    if(error instanceof Error && ['observed_mismatch','stale_target'].includes(error.message))await failFulfillment(pool,{order_id:input.order_id,code:error.message})
    throw error
  }
}

export async function failFulfillment(pool: Pool, input: { order_id: string; code: string }) {
  return transaction(pool, async client => {
    const found = await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [input.order_id])
    const order = found.rows[0]
    if (!order) throw new Error('order_not_found')
    if (order.fulfillment_state === 'applied') return
    const started = order.fulfillment_state === 'queued' ? nextOrderState(order, { type: 'fulfillment_started' }) : order
    const type = ['stale_target', 'observed_mismatch'].includes(input.code) ? 'fulfillment_needs_intervention' : 'fulfillment_failed'
    const next = nextOrderState(started, { type })
    await client.query('UPDATE orders SET fulfillment_state=$2 WHERE id=$1', [order.id, next.fulfillment_state])
    if(type==='fulfillment_failed' && order.payment_state==='paid')await recordFulfillmentFailure(client,{order_id:order.id,reason:input.code,actor:'commercial-fulfillment'})
  })
}

/** Worker-only runtime configuration; omit actor to use paid-subscription service authority.
 * An explicit actor retains the shared onboarding vendor grant/replay checks.
 * Provisioning runs outside commercial row locks because it owns its own transactions.
 */
export type EnrollmentRuntime = { config: Config; actor?: RegistryActor }
async function enrollNewOrder(pool: Pool, orderId: string, runtime?: EnrollmentRuntime) {
  const reservation = await transaction(pool, async client => {
    const customerId = (await client.query('SELECT customer_id FROM orders WHERE id=$1', [orderId])).rows[0]?.customer_id
    if (!customerId) throw Error('order_not_found')
    // Same customer -> subscription -> order lock ordering as quote acceptance.
    const customer = (await client.query('SELECT * FROM customers WHERE id=$1 FOR UPDATE', [customerId])).rows[0]
    const sub = (await client.query('SELECT * FROM subscriptions WHERE customer_id=$1 FOR UPDATE', [customerId])).rows[0]
    const order = (await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [orderId])).rows[0]
    if (!['paid','not_required'].includes(order.payment_state) || order.cancelled) throw Error('order_not_released')
    if (order.kind !== 'new') return null
    if (sub.tenant_id) {
      const incomplete=await client.query('SELECT 1 FROM shared_onboardings WHERE request_id=$1 AND job_id IS NULL',[customer.enrollment_request_id])
      if(!incomplete.rowCount)return null
    }
    if (sub.target_revision_id !== order.target_revision_id) throw Error('stale_target')
    if (!customer.admin_login) return { reason: 'enrollment_admin_missing' } as const
    if (!runtime) return { reason: 'enrollment_runtime_missing' } as const
    const snapshot = (await client.query('SELECT snapshot FROM subscription_revisions WHERE id=$1', [order.target_revision_id])).rows[0].snapshot
    const catalog = (await client.query(`SELECT r.catalog_version,e.solution FROM catalog_releases r JOIN catalog_entries e ON e.version=r.catalog_version
      WHERE r.id=$1 AND e.status='published' FOR SHARE OF r,e`, [snapshot.entitlement.catalog_release_id])).rows[0]
    if (!catalog || !catalog.solution.tiers.some((t: {id:string;modules:string[]}) => t.id==='core' && t.modules.length===0)) throw Error('enrollment_base_catalog_missing')
    const requestId = customer.enrollment_request_id ?? randomUUID()
    await client.query('UPDATE customers SET enrollment_request_id=$2 WHERE id=$1', [customer.id,requestId])
    // Onboarding does not accept an arbitrary commercial policy. Pin the base
    // catalog to the immutable subscription entitlement; reconfigure applies it later.
    return { input: { request_id: requestId, name: customer.name, admin_name: customer.admin_name ?? customer.name.slice(0,120), admin_login: customer.admin_login,
      catalog_version: catalog.catalog_version, catalog_tier: 'core', reason: `Enroll paid subscription ${sub.id}` }, customerId, subscriptionId: sub.id }
  })
  if (!reservation || 'reason' in reservation) return reservation
  const actor = runtime!.actor ?? commercialEnrollmentActor(runtime!.config,reservation.input.request_id)
  const tenant = await onboardSharedTenant(pool,runtime!.config,actor,reservation.input)
  await transaction(pool,async client => {
    await client.query('SELECT id FROM customers WHERE id=$1 FOR UPDATE',[reservation.customerId])
    const sub=(await client.query('SELECT tenant_id,target_revision_id FROM subscriptions WHERE id=$1 FOR UPDATE',[reservation.subscriptionId])).rows[0]
    const order=(await client.query('SELECT payment_state,cancelled,target_revision_id FROM orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0]
    if (!['paid','not_required'].includes(order.payment_state) || order.cancelled || sub.target_revision_id!==order.target_revision_id) throw Error('order_not_released')
    if (sub.tenant_id && sub.tenant_id!==tenant.tenant_id) throw Error('enrollment_link_conflict')
    await client.query('UPDATE customers SET tenant_id=$2 WHERE id=$1 AND (tenant_id IS NULL OR tenant_id=$2)',[reservation.customerId,tenant.tenant_id])
    if(!sub.tenant_id)await client.query('UPDATE subscriptions SET tenant_id=$2,revision=revision+1 WHERE id=$1',[reservation.subscriptionId,tenant.tenant_id])
    await client.query('UPDATE commercial_branches SET tenant_id=$2 WHERE subscription_id=$1 AND tenant_id IS NULL',[reservation.subscriptionId,tenant.tenant_id])
  })
  return null
}
export async function processFulfillmentOutbox(pool: Pool, options: { limit?: number; enrollment?: EnrollmentRuntime } = {}) {
  const limit=options.limit??20
  if (!Number.isSafeInteger(limit) || limit<1 || limit>1000) throw Error('limit_invalid')
  const rows=await claimOutbox(pool,['fulfillment.enqueue'],limit)
  const results: {order_id:string;job_id?:string;reason?:string}[]=[]
  for (const row of rows) {
    try {
      const enrollment=await enrollNewOrder(pool,row.aggregate_id,options.enrollment)
      const result=await transaction(pool,async client=>{
        // claimOutbox releases selection locks; reacquire to serialize consumers.
        const pending=await client.query("SELECT id FROM commercial_outbox WHERE id=$1 AND status='pending' FOR UPDATE",[row.id])
        if(!pending.rowCount)return null
        const found=await client.query(`SELECT o.*,s.tenant_id,s.applied_revision_id,s.target_revision_id AS subscription_target,
          s.trial_ends_at,r.snapshot
          FROM orders o JOIN subscriptions s ON s.id=o.subscription_id JOIN subscription_revisions r ON r.id=o.target_revision_id
          WHERE o.id=$1 FOR UPDATE OF o,s`,[row.aggregate_id])
        const order=found.rows[0]
        if(!order)throw Error('order_not_found')
        if(!order.tenant_id){
          const reason=enrollment?.reason??'tenant_required'
          await client.query("UPDATE commercial_outbox SET payload=payload||jsonb_build_object('reason','tenant_required','enrollment_reason',$2::text) WHERE id=$1",[row.id,reason])
          return {order_id:order.id as string,reason}
        }
        const readiness=await client.query(`SELECT 1 FROM shared_onboardings o JOIN tenants t ON t.id=o.control_tenant_id
          LEFT JOIN shared_jobs j ON j.id=o.job_id WHERE o.control_tenant_id=$1
          AND (t.status<>'active' OR o.stage<>'active' OR j.state IS DISTINCT FROM 'verified'
          OR j.payload_digest IS DISTINCT FROM o.job_digest OR j.receipt->>'payloadDigest' IS DISTINCT FROM o.job_digest)`,[order.tenant_id])
        if(readiness.rowCount){
          await client.query("UPDATE commercial_outbox SET payload=payload||jsonb_build_object('reason','enrollment_pending') WHERE id=$1",[row.id])
          return {order_id:order.id as string,reason:'enrollment_pending'}
        }
        if(!['paid','not_required'].includes(order.payment_state) || order.cancelled)throw Error('order_not_released')
        if(order.fulfillment_state==='applied'){await completeOutbox(client,row.id);return {order_id:order.id as string}}
        const renewalFastPath=order.kind==='renewal' && !order.subscription_target && order.applied_revision_id===order.target_revision_id && !order.trial_ends_at
        if(renewalFastPath){
          // A normal renewal retains the already-applied immutable policy: no Odoo effect
          // or reconfigure business-key replay is needed, only paid period rollover.
          const renewal=await client.query('SELECT period_end FROM renewals WHERE order_id=$1 FOR UPDATE',[order.id])
          if(!renewal.rowCount)throw Error('renewal_missing')
          await client.query('UPDATE subscriptions SET renewal_at=GREATEST(renewal_at,$2::date),revision=revision+1 WHERE id=$1',[order.subscription_id,renewal.rows[0].period_end])
          await client.query("UPDATE orders SET fulfillment_state='applied' WHERE id=$1",[order.id])
          await completeOutbox(client,row.id)
          return {order_id:order.id as string}
        }
        const renewalFromTrial=order.kind==='renewal' && !order.subscription_target && order.applied_revision_id===order.target_revision_id
        if(order.subscription_target!==order.target_revision_id && !renewalFromTrial)throw Error('stale_target')
        const binding=await client.query('SELECT * FROM shared_registry_bindings WHERE control_tenant_id=$1 AND enabled=true FOR SHARE',[order.tenant_id])
        if(!binding.rowCount)throw Error('tenant_unavailable')
        const b=binding.rows[0]
        const operation=randomUUID()
        const effect=await client.query(`INSERT INTO fulfillment_effects(id,order_id,operation_id) VALUES($1,$2,$3)
          ON CONFLICT(order_id) DO UPDATE SET order_id=EXCLUDED.order_id RETURNING operation_id`,[randomUUID(),order.id,operation])
        const branches=await listBranches(client,order.subscription_id)
        const authority:FulfillmentAuthority={order_id:order.id,operation_id:effect.rows[0].operation_id,previous_revision_id:order.applied_revision_id,
          target_revision_id:order.target_revision_id,entitlement:{modules:order.snapshot.entitlement.modules,features:order.snapshot.entitlement.features,
            digest:order.snapshot.entitlement.digest,compiler_version:order.snapshot.entitlement.compiler_version},
          branches:{apply:branches.items.filter(x=>x.order_id===order.id && x.state==='pending').map(x=>({branch_id:x.id,name:x.name})),archive:order.snapshot.branch_archive_ids??order.snapshot.branches?.archive??[]},
          commercial_valid_until: await commercialValidUntil(client, order)}
        const job=await enqueueReconfigureJob(client,{schemaVersion:1,operation:'reconfigure',requestId:authority.operation_id,controlTenantId:order.tenant_id,
          host:b.host,binding:{tenantId:b.tenant_id,database:b.database_name,filestore:b.filestore,registryRevision:Number(b.registry_revision)},authority})
        await client.query('UPDATE fulfillment_effects SET job_id=$2 WHERE order_id=$1',[order.id,job.id])
        await client.query("UPDATE orders SET fulfillment_state='queued' WHERE id=$1 AND fulfillment_state='not_started'",[order.id])
        await completeOutbox(client,row.id)
        return {order_id:order.id as string,job_id:job.id}
      })
      if(result)results.push(result)
    }catch(error){
      const code=error instanceof Error?error.message:'fulfillment_enqueue_failed'
      if(code==='stale_target')await failFulfillment(pool,{order_id:row.aggregate_id,code})
      await failOutbox(pool,row.id,code)
      results.push({order_id:row.aggregate_id,reason:code})
    }
  }
  return results
}
