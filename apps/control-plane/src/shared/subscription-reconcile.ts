import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Pool } from 'pg'
import { transaction } from '../db.js'
import { enqueueReconfigureJob } from './job-store.js'
import { listBranches } from '../commercial/branches.js'
import { aiValuesCurrent, deliveredEntitlement } from '../commercial/ai-ledger.js'

export type ObserveRunner = (input: {tenant_id:string;database:string;restore_id?:string;signal?:AbortSignal}) => Promise<{
  commercial_revision_id:string|null;commercial_digest:string|null;
  status:'active'|'suspended';commercial_valid_until:string|null;
  branches:{branch_id:string;odoo_company_id:number|null;active:boolean}[]
  /** The tenant's current feature values, when the observation carries them (the Odoo observation does). */
  features?:Record<string,boolean|number|null>
}>
export function fakeObserveRunner(result: Awaited<ReturnType<ObserveRunner>>): ObserveRunner {
  return async () => structuredClone(result)
}
export async function reconcileAfterRestore(pool: Pool, input: {tenant_id:string;runner:ObserveRunner;restore_id?:string;target?:{database:string;filestore:string;host:string}}): Promise<{ready:boolean;job_id?:string;reason?:string}> {
  const authorityQuery=`SELECT s.id,s.revision,s.state,s.commercial_expiry_revision,s.applied_revision_id,r.snapshot,b.* FROM subscriptions s
    JOIN subscription_revisions r ON r.id=s.applied_revision_id JOIN shared_registry_bindings b ON b.control_tenant_id=s.tenant_id WHERE s.tenant_id=$1`
  const found=await pool.query(authorityQuery,[input.tenant_id])
  if(!found.rowCount)return {ready:false,reason:'tenant_binding_mismatch'}
  const before=found.rows[0]
  if(input.target && !input.restore_id)throw Error('shared_restore_approval_unavailable')
  if(input.target){
    const approval=await pool.query(`SELECT 1 FROM shared_restore_approvals a LEFT JOIN shared_jobs j ON j.payload->>'approvalId'=a.id::text WHERE (a.id=$1 OR j.id=$1) AND a.control_tenant_id=$2 AND a.target_database=$3`,[input.restore_id,input.tenant_id,input.target.database])
    if(!approval.rowCount || input.target.database!==input.target.filestore)throw Error('shared_restore_approval_unavailable')
  }
  const observed=await input.runner({tenant_id:input.tenant_id,database:input.target?.database??before.database_name,restore_id:input.restore_id})
  return transaction(pool,async client=>{
    const current=await client.query(authorityQuery+' FOR UPDATE OF s',[input.tenant_id])
    const row=current.rows[0]
    if(!row || row.id!==before.id || row.revision!==before.revision || row.registry_revision!==before.registry_revision)
      return {ready:false,reason:'commercial_authority_changed'}

    // The exact source job carries the date derived by fulfillment/trial rules.
    // Earlier or restore jobs are never authorities for current lifecycle state.
    let expiry:string|null=null
    if(Number(row.commercial_expiry_revision)>0){
      const source=await client.query(`SELECT payload->'authority'->>'commercial_valid_until' AS expiry FROM shared_jobs
        WHERE control_tenant_id=$1 AND payload->>'operation'='reconfigure'
        AND COALESCE(payload->>'restore','false')='false'
        AND payload->'authority'->>'target_revision_id'=$2
        AND payload->'authority'->>'commercial_valid_until_revision'=$3
        AND (payload->'authority') ? 'commercial_valid_until' ORDER BY created_at DESC,id DESC LIMIT 1`,
      [input.tenant_id,row.applied_revision_id,String(row.commercial_expiry_revision)])
      const date=z.iso.date().nullable().safeParse(source.rows[0]?.expiry)
      if(!date.success)return {ready:false,reason:'commercial_lifecycle_authority_unavailable'}
      expiry=date.data
    }
    const status=row.state==='suspended'?'suspended':'active'
    if(observed.status!==status || observed.commercial_valid_until!==expiry)
      return {ready:false,reason:'commercial_lifecycle_mismatch'}
    // A backup older than a top-up (or a refund) restores the revision but the AI values of its day: they are ledger values,
    // not part of the digest, so they are compared on their own.
    const aiCurrent=!observed.features || await aiValuesCurrent(client,row.snapshot.customer_id,observed.features)
    if(observed.commercial_revision_id===row.applied_revision_id && observed.commercial_digest===row.snapshot.entitlement.digest && aiCurrent)return {ready:true}
    const order=await client.query("SELECT id FROM orders WHERE subscription_id=$1 AND target_revision_id=$2 AND fulfillment_state='applied' ORDER BY created_at DESC LIMIT 1",[row.id,row.applied_revision_id])
    if(!order.rowCount)return {ready:false,reason:'applied_order_missing'}
    const branches=await listBranches(client,row.id)
    const authority={order_id:order.rows[0].id,operation_id:randomUUID(),previous_revision_id:observed.commercial_revision_id,target_revision_id:row.applied_revision_id,
      entitlement:await deliveredEntitlement(client,row.snapshot.customer_id,{modules:row.snapshot.entitlement.modules,features:row.snapshot.entitlement.features,digest:row.snapshot.entitlement.digest,compiler_version:row.snapshot.entitlement.compiler_version}),branches:{apply:branches.items.filter(b=>b.state==='active' && b.kind==='extra').map(b=>({branch_id:b.id,name:b.name})),archive:branches.items.filter(b=>b.state==='archived').map(b=>b.id)}}
    const job=await enqueueReconfigureJob(client,{schemaVersion:1,operation:'reconfigure',requestId:authority.operation_id,controlTenantId:input.tenant_id,host:input.target?.host??row.host,
      binding:{tenantId:row.tenant_id,database:input.target?.database??row.database_name,filestore:input.target?.filestore??row.filestore,registryRevision:Number(row.registry_revision)},authority,restore:true,restoreId:input.restore_id??order.rows[0].id})
    return {ready:false,job_id:job.id,...(['needs_intervention','verified'].includes(job.state)?{reason:'commercial_reconcile_failed'}:{})}
  })
}

/** Durable interrupted-effect recovery is handled by the reconfigure worker;
 * it preserves operation_id and observes before asking for any mutation permit. */
export async function recoverInterrupted(pool:Pool, options: {runner?: import('./subscription-reconfigure.js').SubscriptionRunner} = {}) {
  const {runSubscriptionReconfigure}=await import('./subscription-reconfigure.js')
  const rows=await pool.query(`SELECT id FROM shared_jobs WHERE payload->>'operation'='reconfigure'
    AND ((state='running' AND lease_until<=clock_timestamp()) OR (state='needs_intervention' AND journal->>'stage'='started')) ORDER BY created_at`)
  const results=[]
  for(const row of rows.rows)results.push(await runSubscriptionReconfigure(pool,row.id,options.runner,true))
  return results
}
