/** Durable intent only in the API; physical observation and route writes belong to the worker. */
import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { z } from 'zod'
import { transaction, isTransientDatabaseError } from '../db.js'
import { actorLabel } from '../admin-auth/grants.js'
import { RegistryError, type RegistryActor } from './registry-store.js'
import { publishOdooRestore, requireOdooRestorePublicationAuthority } from './odoo-backup.js'
import type { SharedRuntimeConfig } from './runtime-config.js'
import type { SharedFencedAdapter } from './job-worker.js'
import type { CommercialRestoreRunner } from './shared-backup.js'

export async function restorePublication(pool: Pool, tenantId: string, approvalId: string) {
  z.uuid().parse(tenantId); z.uuid().parse(approvalId)
  const result = await pool.query('SELECT approval_id AS "approvalId",status,code,host FROM shared_restore_publications WHERE approval_id=$1 AND control_tenant_id=$2',[approvalId,tenantId])
  if (!result.rowCount) throw new RegistryError('restore_publication_unavailable',404)
  return result.rows[0] as {approvalId:string;status:'queued'|'published'|'needs_intervention';code:string|null;host:string|null}
}

export async function requestRestorePublication(pool: Pool, runtime: SharedRuntimeConfig, actor: RegistryActor, tenantId: string, approvalId: string, reason: string) {
  z.uuid().parse(tenantId); z.uuid().parse(approvalId); reason=z.string().trim().min(3).max(1000).parse(reason)
  await transaction(pool,async client=>{
    await requireOdooRestorePublicationAuthority(client,tenantId,actor)
    const target=await client.query(`SELECT t.approval_id FROM shared_odoo_restore_targets t
      JOIN shared_restore_approvals a ON a.id=t.approval_id
      JOIN shared_jobs j ON j.control_tenant_id=t.control_tenant_id AND j.payload->>'approvalId'=t.approval_id::text
      WHERE t.approval_id=$1 AND t.control_tenant_id=$2 AND a.control_tenant_id=$2
      AND t.runtime_scope=$3 AND a.consumed_at IS NOT NULL AND j.state='verified'
      AND j.payload->>'operation'='restore' AND j.receipt->>'status'='verified' FOR SHARE OF t,a,j`,[approvalId,tenantId,runtime.projectName])
    if(target.rowCount!==1)throw new RegistryError('shared_restore_unverified')
    const inserted=await client.query(`INSERT INTO shared_restore_publications(approval_id,control_tenant_id,runtime_scope,issuer,actor_uid,reason)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(approval_id) DO NOTHING RETURNING approval_id`,[approvalId,tenantId,runtime.projectName,actor.issuer,actor.actorUid,reason])
    if(inserted.rowCount)await client.query('INSERT INTO audit_events(id,actor,action,subject,reason) VALUES($1,$2,$3,$4,$5)',[randomUUID(),actorLabel(actor),'shared_odoo_restore.publication_requested',approvalId,reason])
  })
  return restorePublication(pool,tenantId,approvalId)
}

export async function dispatchRestorePublication(pool: Pool, runtime: SharedRuntimeConfig, adapter: Pick<SharedFencedAdapter,'observe'>, options:{runner?:CommercialRestoreRunner}={}) {
  const candidates=await pool.query("SELECT * FROM shared_restore_publications WHERE status='queued' AND runtime_scope=$1 ORDER BY updated_at,created_at LIMIT 10",[runtime.projectName])
  let waiting:string|undefined
  for(const row of candidates.rows){
    const client=await pool.connect();let held=false,broken=false
    try{
      held=(await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS held',['restore-publication:'+row.approval_id])).rows[0].held
      if(!held)continue
      if(!(await client.query("SELECT 1 FROM shared_restore_publications WHERE approval_id=$1 AND status='queued'",[row.approval_id])).rowCount)continue
      const actor={issuer:row.issuer as string,actorUid:Number(row.actor_uid)}
      await transaction(pool,c=>requireOdooRestorePublicationAuthority(c,row.control_tenant_id,actor))
      try{
        const result=await publishOdooRestore(pool,runtime,actor,row.approval_id,job=>adapter.observe(job),options)
        await client.query("UPDATE shared_restore_publications SET status='published',code=NULL,host=$2,updated_at=now() WHERE approval_id=$1",[row.approval_id,result.host])
        return {state:'published',approvalId:row.approval_id}
      }catch(error){
        if(error instanceof RegistryError && error.code==='commercial_reconciliation_pending'){
          await client.query("UPDATE shared_restore_publications SET code='commercial_reconciliation_pending',updated_at=now() WHERE approval_id=$1",[row.approval_id])
          waiting=row.approval_id;continue
        }
        throw error
      }
    }catch(error){
      if(isTransientDatabaseError(error))throw error
      // Never return physical executor messages, paths, credentials or raw errors.
      await client.query("UPDATE shared_restore_publications SET status='needs_intervention',code='restore_publication_unverified',updated_at=now() WHERE approval_id=$1",[row.approval_id])
      return {state:'needs_intervention',approvalId:row.approval_id}
    }finally{
      if(held)await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',['restore-publication:'+row.approval_id]).catch(()=>{broken=true})
      client.release(broken)
    }
  }
  return waiting?{state:'queued',approvalId:waiting}:{state:'idle'}
}
