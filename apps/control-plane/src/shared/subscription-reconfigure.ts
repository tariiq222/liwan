import { createHash, randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { AI_ENTITLEMENT_KEYS } from '@liwan/commercial-contracts'
import { sharedReconfigureJobSchema, type SharedReconfigureJob } from '@liwan/commercial-contracts/shared'
import { transaction } from '../db.js'
import { applyReceipt, failFulfillmentOn, type SubscriptionReceipt } from '../commercial/fulfillment.js'
import { deliveredEntitlement, pushAiEntitlement, pushAiIfStale } from '../commercial/ai-ledger.js'
import type { ObserveRunner } from './subscription-reconcile.js'

export type SubscriptionRunner = (input: {job:SharedReconfigureJob;action:'observe'|'reconfigure';attemptId:string;fence:number;assertOwned:()=>Promise<void>}) => Promise<unknown>
export interface SubscriptionAdapter {
  subscriptionRunner?: SubscriptionRunner
  observeSubscription?: ObserveRunner
  /** Isolated restore topology only. A source observer must never be substituted. */
  observeRestoreSubscription?: ObserveRunner
  observeUsage?: import('../commercial/usage-collector.js').UsageObserveRunner
}
function digest(job:SharedReconfigureJob) {return createHash('sha256').update(JSON.stringify(job)).digest('hex')}
/** What an AI push that a newer revision overtook records instead of a tenant receipt. */
type SupersededReceipt = Partial<SubscriptionReceipt> & { superseded: true; applied_revision_id: string }
async function assertCurrentBinding(client:PoolClient,job:SharedReconfigureJob) {
  const binding=await client.query('SELECT * FROM shared_registry_bindings WHERE control_tenant_id=$1 AND enabled=true FOR SHARE',[job.controlTenantId])
  const b=binding.rows[0]
  if(!b || b.database_name!==job.binding.database || b.tenant_id!==job.binding.tenantId || Number(b.registry_revision)!==job.binding.registryRevision || b.host!==job.host)throw Error('tenant_binding_mismatch')
}
const featuresWithoutAi=(features:Record<string,unknown>)=>JSON.stringify(Object.entries(features).filter(([k])=>!AI_ENTITLEMENT_KEYS.includes(k)).sort(([a],[b])=>a<b?-1:a>b?1:0))
/**
 * An AI push changes nothing but the derived AI keys of the revision the subscription has already applied, so that
 * revision authorizes it, not the payment state of the order that created it (a refunded top-up must still lower the
 * balance). Everything else the job could carry is refused, so the flag can never apply a revision.
 */
async function assertAiPushAuthority(client:PoolClient,job:SharedReconfigureJob) {
  const {authority}=job
  if(job.restore || job.restoreId)throw Error('ai_push_invalid')
  const row=(await client.query(`SELECT s.applied_revision_id,r.snapshot FROM subscriptions s JOIN orders o ON o.subscription_id=s.id
    JOIN subscription_revisions r ON r.id=s.applied_revision_id
    WHERE s.tenant_id=$1 AND o.id=$2 AND o.target_revision_id=s.applied_revision_id FOR SHARE OF s`,[job.controlTenantId,authority.order_id])).rows[0]
  if(!row)throw Error('order_not_released')
  if(row.applied_revision_id!==authority.target_revision_id || authority.previous_revision_id!==authority.target_revision_id)throw Error('stale_target')
  const snapshot=row.snapshot.entitlement
  if(snapshot?.digest!==authority.entitlement.digest)throw Error('observed_mismatch')
  if(JSON.stringify(snapshot.modules)!==JSON.stringify(authority.entitlement.modules) || featuresWithoutAi(snapshot.features)!==featuresWithoutAi(authority.entitlement.features))throw Error('ai_push_invalid')
  if(authority.branches.apply.length || authority.branches.archive.length || authority.branches.restore?.length || Object.hasOwn(authority,'commercial_valid_until') || Object.hasOwn(authority,'commercial_valid_until_revision'))throw Error('ai_push_invalid')
  await assertCurrentBinding(client,job)
}
/** The job with the live AI keys of the customer's ledger and settings, read at execution time instead of when it was queued. */
async function withLiveAiFeatures(client:PoolClient,job:SharedReconfigureJob):Promise<SharedReconfigureJob> {
  if(job.restore)return job
  const customer=(await client.query('SELECT customer_id FROM orders WHERE id=$1',[job.authority.order_id])).rows[0]?.customer_id
  if(!customer)return job
  return {...job,authority:{...job.authority,entitlement:await deliveredEntitlement(client,customer,job.authority.entitlement)}}
}
export async function assertReconfigureAuthority(client:PoolClient,job:SharedReconfigureJob) {
  if(job.authority.ai_push)return assertAiPushAuthority(client,job)
  const result=await client.query(`SELECT s.applied_revision_id,s.target_revision_id,r.snapshot,o.payment_state,o.fulfillment_state,o.cancelled
    FROM subscriptions s JOIN orders o ON o.subscription_id=s.id JOIN subscription_revisions r ON r.id=$3
    WHERE s.tenant_id=$1 AND o.id=$2 AND r.subscription_id=s.id FOR SHARE OF s,o`,[job.controlTenantId,job.authority.order_id,job.authority.target_revision_id])
  const row=result.rows[0]
  if(!row || !['paid','not_required'].includes(row.payment_state) || row.cancelled)throw Error('order_not_released')
  // A paid trial renewal legitimately reuses the applied revision while the order is still
  // queued, so accepting only `target_revision_id` would mark it stale before the effect runs.
  const renewalOfApplied = row.target_revision_id === null && row.applied_revision_id === job.authority.target_revision_id
  if((job.restore || row.fulfillment_state==='applied' || renewalOfApplied ? row.applied_revision_id : row.target_revision_id)!==job.authority.target_revision_id)throw Error('stale_target')
  if(row.snapshot.entitlement?.digest!==job.authority.entitlement.digest)throw Error('observed_mismatch')
  if(job.restore){
    const approved=await client.query(`SELECT 1 FROM shared_restore_approvals a LEFT JOIN shared_jobs j ON j.payload->>'approvalId'=a.id::text
      WHERE (a.id=$1 OR j.id=$1) AND a.control_tenant_id=$2 AND a.target_database=$3`,[job.restoreId,job.controlTenantId,job.binding.database])
    if(!approved.rowCount)throw Error('shared_restore_approval_unavailable')
  }else{
    await assertCurrentBinding(client,job)
  }
}

export async function runSubscriptionReconfigure(pool:Pool,id:string,runner?:SubscriptionRunner,recover=false) {
  if(!runner)throw Error('shared_adapter_unavailable')
  const claim=await transaction(pool,async client=>{
    const found=await client.query('SELECT * FROM shared_jobs WHERE id=$1 FOR UPDATE',[id])
    const row=found.rows[0]
    if(!row || (!recover && row.state!=='queued') || (recover && !(row.state==='needs_intervention' || (row.state==='running' && new Date(row.lease_until).getTime()<=Date.now()))))throw Error('shared_job_not_claimable')
    const queuedJob=sharedReconfigureJobSchema.parse(row.payload)
    if(row.payload_digest!==digest(queuedJob))throw Error('shared_job_identity_corrupt')
    const job=queuedJob
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[job.controlTenantId])
    const blocked=await client.query("SELECT id FROM shared_jobs WHERE control_tenant_id=$1 AND id<>$2 AND state IN ('running','needs_intervention') LIMIT 1",[job.controlTenantId,id])
    if(blocked.rowCount)throw Error('shared_reconciliation_required')
    if(job.authority.ai_push){
      // A newer revision applied after this push was queued: it delivered the live values itself, so this push is
      // superseded. It completes without touching the tenant, and the current revision gets a fresh push in case its
      // delivery was built before the change that queued this one.
      const current=(await client.query('SELECT customer_id,applied_revision_id FROM subscriptions WHERE tenant_id=$1 FOR SHARE',[job.controlTenantId])).rows[0]
      if(!current){
        // Nothing to deliver to and nobody to push for: a balance change that cannot be applied must not look done. It
        // ends `failed` (which does not block the tenant), is logged, and shows on the operation feed. A subscription is
        // bound to its tenant once (from NULL) and a customer has one subscription, so there is no other tenant to re-push to.
        const code='ai_push_no_subscription'
        console.error(`[control-plane] AI balance push ${id} for tenant ${job.controlTenantId} cannot be delivered: ${code}`)
        await client.query("UPDATE shared_jobs SET state='failed',lease_until=NULL,journal=$2 WHERE id=$1",[id,{stage:'failed',operation_id:job.authority.operation_id,error_code:code}])
        return {failed:code}
      }
      if(current.applied_revision_id!==job.authority.target_revision_id){
        const receipt:SupersededReceipt={superseded:true,applied_revision_id:current.applied_revision_id}
        await client.query("UPDATE shared_jobs SET state='verified',receipt=$2,lease_until=NULL,journal=$3 WHERE id=$1",[id,receipt,{stage:'verified',operation_id:job.authority.operation_id,superseded:true}])
        await pushAiEntitlement(client,current.customer_id)
        return {superseded:receipt}
      }
    }
    const live=await withLiveAiFeatures(client,job)
    const attemptId=randomUUID(),fence=Number(row.fence)+1
    if(!Number.isSafeInteger(fence))throw Error('shared_fence_invalid')
    await client.query("UPDATE shared_jobs SET state='running',attempt_id=$2,fence=$3,lease_until=clock_timestamp()+interval '120 seconds' WHERE id=$1",[id,attemptId,fence])
    return {job:live,attemptId,fence}
  })
  if('failed' in claim)throw Error(claim.failed)
  if('superseded' in claim)return {state:'verified',receipt:claim.superseded}
  const owned=async <T>(action:(client:PoolClient)=>Promise<T>)=>transaction(pool,async client=>{
    const current=await client.query("SELECT 1 FROM shared_jobs WHERE id=$1 AND attempt_id=$2 AND fence=$3 AND state='running' AND lease_until>clock_timestamp() FOR UPDATE",[id,claim.attemptId,claim.fence])
    if(!current.rowCount)throw Error('shared_lease_lost')
    await assertReconfigureAuthority(client,claim.job)
    return action(client)
  })
  const assertOwned=()=>owned(async client=>{await client.query("UPDATE shared_jobs SET lease_until=clock_timestamp()+interval '120 seconds' WHERE id=$1",[id])})
  try {
    await assertOwned()
    await owned(async client=>{
      await client.query("UPDATE shared_jobs SET journal=$2 WHERE id=$1",[id,{stage:'started',operation_id:claim.job.authority.operation_id,attemptId:claim.attemptId}])
      if(!claim.job.restore && !claim.job.authority.ai_push)await client.query("UPDATE orders SET fulfillment_state='applying' WHERE id=$1 AND fulfillment_state='queued'",[claim.job.authority.order_id])
    })
    // Python always observes first. Same immutable operation_id returns the
    // existing receipt after a crash; it never duplicates modules/branches.
    const receipt=await runner({...claim,action:'reconfigure',assertOwned}) as SubscriptionReceipt
    await assertOwned()
    if(receipt.order_id!==claim.job.authority.order_id || receipt.database!==claim.job.binding.database || receipt.target_revision_id!==claim.job.authority.target_revision_id || receipt.observed_entitlement_digest!==claim.job.authority.entitlement.digest)throw Error('observed_mismatch')
    if(!claim.job.restore && !claim.job.authority.ai_push)await applyReceipt(pool,{order_id:claim.job.authority.order_id,receipt})
    if(!claim.job.restore && !claim.job.authority.ai_push && (receipt as {commercial_expiry_supported?:boolean}).commercial_expiry_supported===true){
      await pool.query('UPDATE tenants SET commercial_expiry_supported=true WHERE id=$1 AND commercial_expiry_supported IS DISTINCT FROM true',[claim.job.controlTenantId])
    }
    // applyReceipt clears the target; completion checks ownership separately.
    await transaction(pool,async client=>{
      const done=await client.query("UPDATE shared_jobs SET state='verified',receipt=$4,lease_until=NULL,journal=$5 WHERE id=$1 AND attempt_id=$2 AND fence=$3 AND state='running' AND lease_until>clock_timestamp() RETURNING id",[id,claim.attemptId,claim.fence,receipt,{stage:'verified',operation_id:claim.job.authority.operation_id}])
      if(!done.rowCount)throw Error('shared_lease_lost')
      // Values read at claim time may have changed while the job ran: the delivered AI values are checked against the
      // live ones here, in the completing transaction, and a push follows when they differ.
      if(!claim.job.restore){
        const customer=(await client.query('SELECT customer_id FROM orders WHERE id=$1',[claim.job.authority.order_id])).rows[0]?.customer_id
        if(customer)await pushAiIfStale(client,customer,claim.job.authority.entitlement.features)
      }
    })
    return {state:'verified',receipt}
  }catch(error){
    const code=error instanceof Error?error.message:'shared_effect_unverified'
    if(code!=='shared_lease_lost'){
      await transaction(pool,async client=>{
        // An AI push carries no order and the next delivery re-sends the same values, so its failure is closed as `failed`:
        // unlike needs_intervention it does not block the tenant's paid orders. It stays on the operation feed, and is logged.
        const terminal=claim.job.authority.ai_push?'failed':'needs_intervention'
        if(claim.job.authority.ai_push)console.error(`[control-plane] AI balance push ${id} for tenant ${claim.job.controlTenantId} failed: ${code}`)
        const refused=await client.query(`UPDATE shared_jobs SET state=$5,lease_until=NULL,journal=$4
          WHERE id=$1 AND attempt_id=$2 AND fence=$3 AND state='running' AND lease_until>clock_timestamp() RETURNING id`,
        [id,claim.attemptId,claim.fence,{stage:terminal,operation_id:claim.job.authority.operation_id,error_code:code},terminal])
        if(!refused.rowCount)throw Error('shared_lease_lost')
        if(!claim.job.restore && !claim.job.authority.ai_push)await failFulfillmentOn(client,{order_id:claim.job.authority.order_id,code})
        if(!claim.job.restore && code==='tenant_upgrade_required'){
          await client.query('UPDATE tenants SET commercial_expiry_supported=false WHERE id=$1',[claim.job.controlTenantId])
        }
      })
    }
    throw error
  }
}
