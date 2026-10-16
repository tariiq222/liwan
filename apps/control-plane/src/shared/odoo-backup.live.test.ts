// Parent-only execution against a dedicated loopback control scratch database.
import {beforeAll,afterAll,describe,it,expect} from 'vitest'
import {Pool} from 'pg'
import {randomUUID,createHash} from 'node:crypto'
import {mkdtemp,mkdir,writeFile,realpath,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {migrate} from '../db.js'
import {approveOdooRestore,resolveOdooBackupAuthority} from './odoo-backup.js'
import {enqueueSharedJob} from './job-store.js'
import {businessKey,payloadDigest} from './provisioning.js'
import type {SharedRuntimeConfig} from './runtime-config.js'
import type {SharedJob} from '@nasq/commercial-contracts/shared'
import { vendorAccount } from '../__tests__/helpers/vendor-session.js'
import { vendorActorIssuer } from '../admin-auth/grants.js'
const url=process.env.CONTROL_TEST_DATABASE_URL
if(url){const u=new URL(url);if(!['localhost','127.0.0.1','::1'].includes(u.hostname)||!/^nasq_control_scratch_[a-z0-9]+$/.test(u.pathname.slice(1)))throw Error('isolated control test database required')}
describe.skipIf(!url)('real Odoo backup/restore authority (live PostgreSQL)',()=>{
 const pool=new Pool({connectionString:url,max:4}),tenant=randomUUID(),backupId=randomUUID(),jobId=randomUUID(),issuer=vendorActorIssuer('odoo-backup-'+randomUUID()),actor={issuer,actorUid:7}
 const db='nasq_scratch_'+randomUUID().replaceAll('-',''),binding={tenantId:'t'+tenant.replaceAll('-',''),database:db,filestore:db,registryRevision:1}
 const job:SharedJob={schemaVersion:1,operation:'backup',requestId:backupId,binding}
 let root='',runtime:SharedRuntimeConfig
 beforeAll(async()=>{
  await migrate(pool);root=await realpath(await mkdtemp(join(tmpdir(),'nasq-real-backup-')))
  runtime={schemaVersion:1,projectName:'nasq-saas-test-backup',composeFile:join(root,'compose.yml'),envFile:join(root,'compose.env'),stateDir:root,domainSuffix:'saas.accept.nasq.test'}
  await vendorAccount(pool,['operations'],7)
  await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Real authority fixture','saas','managed',$2,true)",[tenant,'fixture-'+tenant])
  await pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,true,1)',[tenant,binding.tenantId,binding.tenantId+'.invalid',db])
  const receipt={schemaVersion:1,operation:'backup',binding,businessKey:businessKey(job),payloadDigest:payloadDigest(job),attemptId:randomUUID(),sequence:3,status:'verified'}
  await pool.query("INSERT INTO shared_jobs(id,control_tenant_id,business_key,payload,payload_digest,issuer,actor_uid,reason,state,receipt) VALUES($1,$2,$3,$4,$5,$6,7,'Real fixture','verified',$7)",[jobId,tenant,businessKey(job),job,payloadDigest(job),issuer,receipt])
  const manifest={schemaVersion:1,format:'odoo-pg-filestore-v1',backupId,controlTenantId:tenant,binding,businessKey:businessKey(job),payloadDigest:payloadDigest(job),databaseSha256:'a'.repeat(64),filestoreSha256:'b'.repeat(64),sourceImageId:'sha256:'+'c'.repeat(64),postgresImageId:'sha256:'+'d'.repeat(64),capturedAt:new Date().toISOString(),inventory:{databaseAttachments:[],attachments:[],projects:1,tasks:1,modules:[],profile:[]}}
  const directory=join(root,'backups',backupId);await mkdir(directory,{recursive:true});const bytes=JSON.stringify(manifest);await writeFile(join(directory,'manifest.json'),bytes)
  await pool.query("INSERT INTO shared_backups(id,control_tenant_id,tenant_id,database_name,filestore,snapshot,database_sha256,filestore_sha256,artifact_path,consistency,created_by) VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,'verified',$9)",[backupId,tenant,binding.tenantId,db,manifest,manifest.databaseSha256,manifest.filestoreSha256,directory,issuer])
  await pool.query("INSERT INTO shared_odoo_backups(backup_id,job_id,format,manifest_sha256,source_registry_revision) VALUES($1,$2,'odoo-pg-filestore-v1',$3,1)",[backupId,jobId,createHash('sha256').update(bytes).digest('hex')])
 })
 afterAll(async()=>{await pool.end();if(root)await rm(root,{recursive:true,force:true})})
 it('binds a single queue job to one immutable new target and consumes approval once',async()=>{
  const approval=await approveOdooRestore(pool,runtime,actor,tenant,{backup_id:backupId,reason:'Test isolated restore'})
  const input={schemaVersion:1,requestId:randomUUID(),operation:'restore',approvalId:approval.approval_id}
  const queued=await enqueueSharedJob(pool,tenant,actor,input,'Restore fixture')
  const stored=(await pool.query('SELECT payload FROM shared_jobs WHERE id=$1',[queued.id])).rows[0].payload as SharedJob
  const authority=await resolveOdooBackupAuthority(pool,runtime,stored,{starting:true})
  expect(authority).toHaveProperty('targetDatabase');expect(authority).toHaveProperty('backupId',backupId)
  await expect(enqueueSharedJob(pool,tenant,actor,{...input,requestId:randomUUID()},'Second request refused')).rejects.toThrow('shared_restore_approval_unavailable')
  await pool.query('UPDATE shared_restore_approvals SET consumed_at=clock_timestamp() WHERE id=$1',[approval.approval_id])
  await expect(resolveOdooBackupAuthority(pool,runtime,stored,{starting:true})).rejects.toThrow('shared_restore_approval_unavailable')
  await expect(pool.query('UPDATE shared_restore_approvals SET consumed_at=NULL WHERE id=$1',[approval.approval_id])).rejects.toThrow('already consumed')
  await expect(pool.query('DELETE FROM shared_odoo_restore_targets WHERE approval_id=$1',[approval.approval_id])).rejects.toThrow('permanent')
  await expect(pool.query("UPDATE shared_odoo_restore_targets SET target_database=$2 WHERE approval_id=$1",[approval.approval_id,'nasq_scratch_'+randomUUID().replaceAll('-','')])).rejects.toThrow('append only')
 })
 it('rejects registry publication into a permanently reserved restore target',async()=>{
  const approval=await approveOdooRestore(pool,runtime,actor,tenant,{backup_id:backupId,reason:'Reserve new target'})
  const target=(await pool.query('SELECT target_database FROM shared_odoo_restore_targets WHERE approval_id=$1',[approval.approval_id])).rows[0].target_database
  const other=randomUUID();await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Collision fixture','saas','managed',$2,true)",[other,'fixture-'+other])
  await expect(pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,false,1)',[other,'t'+other.replaceAll('-',''),'t'+other+'.invalid',target])).rejects.toThrow('permanently reserved')
 })
 it('rejects a synthetic backup without real metadata even if its manifest has the expected shape',async()=>{
  const synthetic=randomUUID(),dir=join(root,'backups',synthetic);await mkdir(dir,{recursive:true})
  const source=JSON.parse(await (await import('node:fs/promises')).readFile(join(root,'backups',backupId,'manifest.json'),'utf8'));source.backupId=synthetic
  await writeFile(join(dir,'manifest.json'),JSON.stringify(source))
  await pool.query("INSERT INTO shared_backups(id,control_tenant_id,tenant_id,database_name,filestore,snapshot,database_sha256,filestore_sha256,artifact_path,consistency,created_by) VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,'verified',$9)",[synthetic,tenant,binding.tenantId,db,source,source.databaseSha256,source.filestoreSha256,dir,issuer])
  await expect(approveOdooRestore(pool,runtime,actor,tenant,{backup_id:synthetic,reason:'Reference artifact refused'})).rejects.toThrow('shared_backup_unavailable')
 })
 it.each(['consumed','expired'])('replays only the exact verified request after approval is %s',async(state)=>{
  // Persist a historical verified effect directly: this fixture tests enqueue
  // replay, not physical receipt production, and never runs application SQL.
  const approval=randomUUID(),requestId=randomUUID(),restoredJobId=randomUUID(),target='nasq_scratch_'+randomUUID().replaceAll('-','')
  await pool.query(`INSERT INTO shared_restore_approvals(id,backup_id,control_tenant_id,target_database,reason,expires_at,consumed_at)
   VALUES($1,$2,$3,$4,'Historical effect',clock_timestamp()+$5::interval,CASE WHEN $6 THEN clock_timestamp() ELSE NULL END)`,[approval,backupId,tenant,target,state==='expired'?'-1 second':'1 hour',state==='consumed'])
  await pool.query('INSERT INTO shared_odoo_restore_targets(approval_id,backup_id,control_tenant_id,target_database,source_binding,runtime_scope) VALUES($1,$2,$3,$4,$5,$6)',[approval,backupId,tenant,target,binding,runtime.projectName])
  const restored:SharedJob={schemaVersion:1,operation:'restore',requestId,binding,approvalId:approval,backup:{schemaVersion:1,backupId,binding,databaseSha256:'a'.repeat(64),filestoreSha256:'b'.repeat(64),consistency:'verified'}}
  const receipt={schemaVersion:1,operation:'restore',binding,businessKey:businessKey(restored),payloadDigest:payloadDigest(restored),attemptId:randomUUID(),sequence:3,status:'verified'}
  await pool.query("INSERT INTO shared_jobs(id,control_tenant_id,business_key,payload,payload_digest,issuer,actor_uid,reason,state,receipt) VALUES($1,$2,$3,$4,$5,$6,7,'Historical verified effect','verified',$7)",[restoredJobId,tenant,businessKey(restored),restored,payloadDigest(restored),issuer,receipt])
  const input={schemaVersion:1,operation:'restore',requestId,approvalId:approval}
  expect(await enqueueSharedJob(pool,tenant,actor,input,'Authenticated replay')).toEqual({id:restoredJobId,state:'verified',replay:true})
  await vendorAccount(pool,['operations'],8)
  await expect(enqueueSharedJob(pool,tenant,{issuer,actorUid:8},input,'Other operator')).rejects.toThrow('shared_replay_forbidden')
  await expect(enqueueSharedJob(pool,tenant,actor,{...input,requestId:randomUUID()},'Different request')).rejects.toThrow('shared_restore_approval_unavailable')
  await expect(enqueueSharedJob(pool,tenant,actor,{...input,approvalId:randomUUID()},'Different approval')).rejects.toThrow('shared_restore_approval_unavailable')
  await expect(enqueueSharedJob(pool,tenant,actor,{...input,backup:restored.backup},'Injected payload')).rejects.toThrow()
 })
 it('rejects foreign tenant and revoked operator approvals without reserving targets',async()=>{
  await expect(approveOdooRestore(pool,runtime,actor,randomUUID(),{backup_id:backupId,reason:'Foreign approval'})).rejects.toThrow('tenant_operations_unavailable')
  await pool.query("UPDATE vendor_accounts SET status='disabled' WHERE id=7")
  await expect(approveOdooRestore(pool,runtime,actor,tenant,{backup_id:backupId,reason:'Revoked approval'})).rejects.toThrow('shared_job_forbidden')
 })
})
