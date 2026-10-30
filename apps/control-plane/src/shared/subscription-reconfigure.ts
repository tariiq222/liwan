import { createHash, randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { sharedReconfigureJobSchema, type SharedReconfigureJob } from '@liwan/commercial-contracts/shared'
import { transaction } from '../db.js'
import { applyReceipt, failFulfillment, type SubscriptionReceipt } from '../commercial/fulfillment.js'
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
export async function assertReconfigureAuthority(client:PoolClient,job:SharedReconfigureJob) {
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
    const binding=await client.query('SELECT * FROM shared_registry_bindings WHERE control_tenant_id=$1 AND enabled=true FOR SHARE',[job.controlTenantId])
    const b=binding.rows[0]
    if(!b || b.database_name!==job.binding.database || b.tenant_id!==job.binding.tenantId || Number(b.registry_revision)!==job.binding.registryRevision || b.host!==job.host)throw Error('tenant_binding_mismatch')
  }
}

export async function runSubscriptionReconfigure(pool:Pool,id:string,runner?:SubscriptionRunner,recover=false) {
  if(!runner)throw Error('shared_adapter_unavailable')
  const claim=await transaction(pool,async client=>{
    const found=await client.query('SELECT * FROM shared_jobs WHERE id=$1 FOR UPDATE',[id])
    const row=found.rows[0]
    if(!row || (!recover && row.state!=='queued') || (recover && !(row.state==='needs_intervention' || (row.state==='running' && new Date(row.lease_until).getTime()<=Date.now()))))throw Error('shared_job_not_claimable')
    const job=sharedReconfigureJobSchema.parse(row.payload)
    if(row.payload_digest!==digest(job))throw Error('shared_job_identity_corrupt')
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[job.controlTenantId])
    const blocked=await client.query("SELECT id FROM shared_jobs WHERE control_tenant_id=$1 AND id<>$2 AND state IN ('running','needs_intervention') LIMIT 1",[job.controlTenantId,id])
    if(blocked.rowCount)throw Error('shared_reconciliation_required')
    const attemptId=randomUUID(),fence=Number(row.fence)+1
    if(!Number.isSafeInteger(fence))throw Error('shared_fence_invalid')
    await client.query("UPDATE shared_jobs SET state='running',attempt_id=$2,fence=$3,lease_until=clock_timestamp()+interval '120 seconds' WHERE id=$1",[id,attemptId,fence])
    return {job,attemptId,fence}
  })
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
      if(!claim.job.restore)await client.query("UPDATE orders SET fulfillment_state='applying' WHERE id=$1 AND fulfillment_state='queued'",[claim.job.authority.order_id])
    })
    // Python always observes first. Same immutable operation_id returns the
    // existing receipt after a crash; it never duplicates modules/branches.
    const receipt=await runner({...claim,action:'reconfigure',assertOwned}) as SubscriptionReceipt
    await assertOwned()
    if(receipt.order_id!==claim.job.authority.order_id || receipt.database!==claim.job.binding.database || receipt.target_revision_id!==claim.job.authority.target_revision_id || receipt.observed_entitlement_digest!==claim.job.authority.entitlement.digest)throw Error('observed_mismatch')
    if(!claim.job.restore)await applyReceipt(pool,{order_id:claim.job.authority.order_id,receipt})
    if((receipt as {commercial_expiry_supported?:boolean}).commercial_expiry_supported===true){
      await pool.query('UPDATE tenants SET commercial_expiry_supported=true WHERE id=$1 AND commercial_expiry_supported IS DISTINCT FROM true',[claim.job.controlTenantId])
    }
    // applyReceipt clears the target; completion checks ownership separately.
    await transaction(pool,async client=>{
      const done=await client.query("UPDATE shared_jobs SET state='verified',receipt=$4,lease_until=NULL,journal=$5 WHERE id=$1 AND attempt_id=$2 AND fence=$3 AND state='running' AND lease_until>clock_timestamp() RETURNING id",[id,claim.attemptId,claim.fence,receipt,{stage:'verified',operation_id:claim.job.authority.operation_id}])
      if(!done.rowCount)throw Error('shared_lease_lost')
    })
    return {state:'verified',receipt}
  }catch(error){
    const code=error instanceof Error?error.message:'shared_effect_unverified'
    if(code!=='shared_lease_lost'){
      if(!claim.job.restore)await failFulfillment(pool,{order_id:claim.job.authority.order_id,code})
      await pool.query("UPDATE shared_jobs SET state='needs_intervention',lease_until=NULL,journal=$4 WHERE id=$1 AND attempt_id=$2 AND fence=$3 AND state='running'",[id,claim.attemptId,claim.fence,{stage:'needs_intervention',operation_id:claim.job.authority.operation_id,error_code:code}])
      if(code==='tenant_upgrade_required'){
        await pool.query('UPDATE tenants SET commercial_expiry_supported=false WHERE id=$1',[claim.job.controlTenantId])
      }
    }
    throw error
  }
}
