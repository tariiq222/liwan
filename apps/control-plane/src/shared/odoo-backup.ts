import {createHash,randomUUID} from 'node:crypto'
import {readFile,stat,mkdir,writeFile,rename} from 'node:fs/promises'
import {join} from 'node:path'
import type {Pool} from 'pg'
import {z} from 'zod'
import {tenantBindingSchema,type SharedJob,type TenantBinding,sharedReceiptSchema} from '@nasq/commercial-contracts/shared'
import {transaction} from '../db.js'
import {requireJobAuthority} from './job-store.js'
import {REGISTRY_ADVISORY_LOCK,resolveRegistryBinding,registryTargetSchema,type RegistryActor} from './registry-store.js'
import {assertSameBinding,businessKey,payloadDigest} from './provisioning.js'
import {assertNoSymlink,type SharedRuntimeConfig} from './runtime-config.js'

const hash=z.string().regex(/^[a-f0-9]{64}$/)
export const manifestSchema=z.strictObject({
 schemaVersion:z.literal(1),format:z.literal('odoo-pg-filestore-v1'),backupId:z.uuid(),controlTenantId:z.uuid(),binding:tenantBindingSchema,
 businessKey:z.string(),payloadDigest:hash,databaseSha256:hash,filestoreSha256:hash,
 sourceImageId:z.string().regex(/^sha256:[a-f0-9]{64}$/),postgresImageId:z.string().regex(/^sha256:[a-f0-9]{64}$/),capturedAt:z.iso.datetime(),
 inventory:z.strictObject({databaseAttachments:z.array(z.tuple([z.number().int(),hash,z.number().int().nonnegative()])),attachments:z.array(z.tuple([z.number().int(),z.string().nullable(),z.string().nullable(),z.number().int()])),projects:z.number().int(),tasks:z.number().int(),modules:z.array(z.unknown()),profile:z.array(z.unknown())}),
})
export function validateRealBackupManifest(value:unknown,expected:{backupId:string;binding:TenantBinding;controlTenantId:string}){
 const manifest=manifestSchema.parse(value)
 if(manifest.backupId!==expected.backupId || manifest.controlTenantId!==expected.controlTenantId)throw Error('shared_artifact_mismatch')
 assertSameBinding(manifest.binding,expected.binding)
 return manifest
}
export function realRestoreHost(approvalId:string,suffix:string){
 z.uuid().parse(approvalId);z.string().regex(/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/).parse(suffix)
 return `r${approvalId.replaceAll('-','')}.restore.${suffix}`
}
async function readManifest(runtime:SharedRuntimeConfig,backupId:string){
 z.uuid().parse(backupId)
 const directory=join(runtime.stateDir,'backups',backupId),path=join(directory,'manifest.json')
 assertNoSymlink(path)
 if((await stat(path)).size>16*1024*1024)throw Error('shared_artifact_invalid')
 const bytes=await readFile(path)
 return {directory,value:JSON.parse(bytes.toString('utf8')) as unknown,sha256:createHash('sha256').update(bytes).digest('hex')}
}
export async function recordOdooBackup(pool:Pool,runtime:SharedRuntimeConfig,job:SharedJob,claim:{attemptId:string;fence:number;assertOwned:()=>Promise<void>}){
 if(job.operation!=='backup')throw Error('unexpected_job')
 const stored=await readManifest(runtime,job.requestId)
 await claim.assertOwned()
 return transaction(pool,async client=>{
  const rows=await client.query('SELECT id,control_tenant_id,issuer,actor_uid FROM shared_jobs WHERE business_key=$1 AND payload_digest=$2 AND state=\'running\' AND lease_until>clock_timestamp() AND attempt_id=$3 AND fence=$4 FOR UPDATE',[businessKey(job),payloadDigest(job),claim.attemptId,claim.fence])
  if(rows.rowCount!==1)throw Error('shared_lease_lost')
  const row=rows.rows[0];await requireJobAuthority(client,row.control_tenant_id,{issuer:row.issuer,actorUid:Number(row.actor_uid)})
  const manifest=validateRealBackupManifest(stored.value,{backupId:job.requestId,binding:job.binding,controlTenantId:row.control_tenant_id})
  if(manifest.payloadDigest!==payloadDigest(job) || manifest.businessKey!==businessKey(job))throw Error('shared_artifact_mismatch')
  await client.query(`INSERT INTO shared_backups(id,control_tenant_id,tenant_id,database_name,filestore,snapshot,database_sha256,filestore_sha256,artifact_path,consistency,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'verified',$10)`,[job.requestId,row.control_tenant_id,job.binding.tenantId,job.binding.database,job.binding.filestore,manifest,manifest.databaseSha256,manifest.filestoreSha256,stored.directory,`${row.issuer}:${row.actor_uid}`])
  await client.query("INSERT INTO shared_odoo_backups(backup_id,job_id,format,manifest_sha256,source_registry_revision) VALUES($1,$2,'odoo-pg-filestore-v1',$3,$4)",[job.requestId,row.id,stored.sha256,job.binding.registryRevision])
  await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),`${row.issuer}:${row.actor_uid}`,'shared_odoo_backup.verified',job.requestId,'Quiesced database and filestore capture verified',{databaseSha256:manifest.databaseSha256,filestoreSha256:manifest.filestoreSha256}])
 })
}
export async function resolveOdooBackupAuthority(pool:Pool,runtime:SharedRuntimeConfig,job:SharedJob,options:{starting?:boolean}={}){
 const rows=await pool.query('SELECT id,control_tenant_id,issuer,actor_uid FROM shared_jobs WHERE business_key=$1 AND payload_digest=$2',[businessKey(job),payloadDigest(job)])
 if(rows.rowCount!==1)throw Error('shared_job_unavailable')
 const row=rows.rows[0]
 const base={controlTenantId:row.control_tenant_id as string,actor:{issuer:row.issuer as string,actorUid:Number(row.actor_uid)}}
 if(job.operation==='backup'){
  const record=await pool.query('SELECT manifest_sha256 FROM shared_odoo_backups WHERE backup_id=$1 AND job_id=$2',[job.requestId,row.id])
  return {...base,backupId:job.requestId,...(record.rowCount?{manifestSha256:record.rows[0].manifest_sha256 as string}:{})}
 }
 if(job.operation!=='restore')throw Error('unexpected_job')
 const approvals=await pool.query(`SELECT a.*,t.source_binding,t.runtime_scope,m.manifest_sha256,b.database_sha256,b.filestore_sha256
  FROM shared_restore_approvals a JOIN shared_odoo_restore_targets t ON t.approval_id=a.id
  JOIN shared_odoo_backups m ON m.backup_id=t.backup_id JOIN shared_backups b ON b.id=m.backup_id
  WHERE a.id=$1 AND a.backup_id=$2 AND a.control_tenant_id=$3 AND t.control_tenant_id=a.control_tenant_id AND t.backup_id=a.backup_id AND t.target_database=a.target_database`,[job.approvalId,job.backup.backupId,row.control_tenant_id])
 if(approvals.rowCount!==1)throw Error('shared_restore_approval_unavailable')
 const a=approvals.rows[0]
 assertSameBinding(job.binding,a.source_binding)
 if(a.runtime_scope!==runtime.projectName || a.database_sha256!==job.backup.databaseSha256 || a.filestore_sha256!==job.backup.filestoreSha256)throw Error('shared_artifact_mismatch')
 if(options.starting && (a.consumed_at || new Date(a.expires_at).getTime()<=Date.now()))throw Error('shared_restore_approval_unavailable')
 return {...base,backupId:job.backup.backupId,approvalId:job.approvalId,targetDatabase:a.target_database as string,manifestSha256:a.manifest_sha256 as string,databaseSha256:a.database_sha256 as string,filestoreSha256:a.filestore_sha256 as string}
}
export async function approveOdooRestore(pool:Pool,runtime:SharedRuntimeConfig,actor:RegistryActor,controlTenantId:string,input:unknown){
 const request=z.strictObject({backup_id:z.uuid(),reason:z.string().trim().min(3).max(1000)}).parse(input)
 z.uuid().parse(controlTenantId)
 const artifact=await readManifest(runtime,request.backup_id)
 return transaction(pool,async client=>{
  await client.query('SELECT pg_advisory_xact_lock($1)',[REGISTRY_ADVISORY_LOCK])
  await requireJobAuthority(client,controlTenantId,actor)
  const {enabled,...binding}=await resolveRegistryBinding(client,controlTenantId)
  if(!enabled)throw Error('tenant_unavailable')
  const rows=await client.query(`SELECT m.manifest_sha256 FROM shared_odoo_backups m JOIN shared_backups b ON b.id=m.backup_id
   JOIN shared_jobs j ON j.id=m.job_id WHERE b.id=$1 AND b.control_tenant_id=$2 AND j.state='verified' AND j.receipt->>'status'='verified'
   AND j.receipt->>'payloadDigest'=j.payload_digest`,[request.backup_id,controlTenantId])
  if(rows.rowCount!==1 || rows.rows[0].manifest_sha256!==artifact.sha256)throw Error('shared_backup_unavailable')
  validateRealBackupManifest(artifact.value,{backupId:request.backup_id,controlTenantId,binding})
  const approvalId=randomUUID(),target='nasq_scratch_'+randomUUID().replaceAll('-','')
  const reserved=await client.query('SELECT 1 FROM shared_registry_bindings WHERE database_name=$1 OR filestore=$1',[target])
  if(reserved.rowCount)throw Error('restore_target_reserved')
  const result=await client.query(`INSERT INTO shared_restore_approvals(id,backup_id,control_tenant_id,target_database,reason,expires_at)
   VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour') RETURNING expires_at`,[approvalId,request.backup_id,controlTenantId,target,request.reason])
  await client.query('INSERT INTO shared_odoo_restore_targets(approval_id,backup_id,control_tenant_id,target_database,source_binding,runtime_scope) VALUES($1,$2,$3,$4,$5,$6)',[approvalId,request.backup_id,controlTenantId,target,binding,runtime.projectName])
  await client.query('INSERT INTO audit_events(id,actor,action,subject,reason) VALUES($1,$2,$3,$4,$5)',[randomUUID(),`${actor.issuer}:${actor.actorUid}`,'shared_odoo_restore.approved',approvalId,request.reason])
  return {approval_id:approvalId,expires_at:new Date(result.rows[0].expires_at).toISOString()}
 })
}
export async function odooJobProgress(pool:Pool,tenantId:string,jobId:string){
 z.uuid().parse(tenantId);z.uuid().parse(jobId)
 const result=await pool.query(`SELECT j.id,j.state,j.payload->>'operation' AS operation,j.payload->>'approvalId' AS approval_id,m.backup_id
  FROM shared_jobs j LEFT JOIN shared_odoo_backups m ON m.job_id=j.id WHERE j.id=$1 AND j.control_tenant_id=$2`,[jobId,tenantId])
 if(result.rowCount!==1)throw Error('shared_job_unavailable')
 const r=result.rows[0]
 return {id:r.id,state:r.state,operation:r.operation,...(r.state==='verified' && r.backup_id?{backupId:r.backup_id}:{}),...(r.approval_id?{approvalId:r.approval_id}:{})}
}
/** Separate restore registry only. Caller must freshly observe the exact effect first. */
export async function publishOdooRestore(pool:Pool,runtime:SharedRuntimeConfig,actor:RegistryActor,approvalId:string,observe:(job:SharedJob)=>Promise<unknown>){
 z.uuid().parse(approvalId)
 const rows=await pool.query(`SELECT j.payload,j.receipt,j.payload_digest,j.control_tenant_id,t.target_database FROM shared_jobs j
  JOIN shared_odoo_restore_targets t ON t.approval_id::text=j.payload->>'approvalId'
  JOIN shared_restore_approvals a ON a.id=t.approval_id
  WHERE t.approval_id=$1 AND t.runtime_scope=$2 AND j.state='verified' AND a.consumed_at IS NOT NULL`,[approvalId,runtime.projectName])
 if(rows.rowCount!==1)throw Error('shared_restore_unverified')
 const row=rows.rows[0],job=row.payload as SharedJob
 const receipt=sharedReceiptSchema.parse(row.receipt)
 if(receipt.payloadDigest!==payloadDigest(job) || receipt.businessKey!==businessKey(job) || receipt.operation!=='restore')throw Error('shared_restore_unverified')
 assertSameBinding(receipt.binding,job.binding)
 const result=await observe(job) as {state?:string;verified?:boolean;payloadDigest?:string;businessKey?:string;binding?:unknown}
 if(result.state!=='present'||!result.verified||result.payloadDigest!==receipt.payloadDigest||result.businessKey!==receipt.businessKey)throw Error('shared_restore_unverified')
 assertSameBinding(result.binding,job.binding)
 const host=realRestoreHost(approvalId,runtime.domainSuffix)
 // Serialize only the small file publication, after external physical readback.
 await transaction(pool,async client=>{
  await client.query('SELECT pg_advisory_xact_lock($1)',[REGISTRY_ADVISORY_LOCK])
  await requireJobAuthority(client,row.control_tenant_id,actor)
  const {enabled,...sourceBinding}=await resolveRegistryBinding(client,row.control_tenant_id)
  if(!enabled)throw Error('tenant_unavailable')
  assertSameBinding(sourceBinding,job.binding)
  const current=await client.query("SELECT 1 FROM shared_jobs WHERE payload_digest=$1 AND state='verified' AND receipt=$2::jsonb FOR SHARE",[row.payload_digest,JSON.stringify(receipt)])
  if(current.rowCount!==1)throw Error('shared_restore_unverified')
  const dir=join(runtime.stateDir,'restore-registry');await mkdir(dir,{recursive:true});assertNoSymlink(dir)
  const path=join(dir,'registry.json')
  let existing:{schemaVersion:number;snapshotRevision:number;targets:Array<Record<string,unknown>>}={schemaVersion:1,snapshotRevision:0,targets:[]}
  try{assertNoSymlink(path);existing=z.strictObject({schemaVersion:z.literal(1),snapshotRevision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER-1),targets:z.array(registryTargetSchema)}).parse(JSON.parse(await readFile(path,'utf8')))}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  const target={tenantId:'r'+approvalId.replaceAll('-',''),host,database:row.target_database,filestore:row.target_database,enabled:true,registryRevision:1}
  registryTargetSchema.parse(target)
  const old=existing.targets.find(t=>t.host===host)
  if(old && JSON.stringify(old)!==JSON.stringify(target))throw Error('shared_restore_route_conflict')
  if(!old){existing.targets.push(target);existing.snapshotRevision++;const temp=path+'.'+randomUUID();await writeFile(temp,JSON.stringify(existing),{mode:0o644,flag:'wx'});await rename(temp,path)}
  await client.query('INSERT INTO audit_events(id,actor,action,subject,reason) VALUES($1,$2,$3,$4,$5)',[randomUUID(),`${actor.issuer}:${actor.actorUid}`,'shared_odoo_restore.route_published',approvalId,'Verified isolated restore route'])
 })
 return {approvalId,host,database:row.target_database}
}
