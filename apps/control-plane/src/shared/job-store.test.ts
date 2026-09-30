import { expect, it, vi } from 'vitest'
import { createApp } from '../http.js'
import { signServiceRequest } from '@nasq/commercial-contracts/server'
import type { Pool } from 'pg'
import { enqueueSharedJob, bindQueuedRequest, deriveSharedPolicy } from './job-store.js'
import { businessKey, payloadDigest } from './provisioning.js'
const binding = { tenantId: 'a', database: 'db_a', filestore: 'db_a', registryRevision: 1, enabled: true }
const request = { schemaVersion: 1, requestId: '687674dc-5789-4a99-b151-12d69f010cc3', operation: 'provision', catalog: { version: 'v1', tier: 'core', sourceSha256: 'a'.repeat(64) }, policy: { schema_version: 1, channel: 'control_plane', modules: ['nasq_core'], features: { 'users.limit': 10, 'storage.limit_mb': 100 } } }
it('persists one provisioning business key across distinct request IDs', async () => {
  const stored: Array<{id:string,payload_digest:string,state:string,issuer:string,actor_uid:number}> = []
  let inserts=0
  const audits:string[]=[]
  const solution={base_modules:['nasq_core'],tiers:[{id:'core',modules:[],features:[]}]}
  const client={release(){},async query(sql:string,params:any[]=[]){
    const result=(rows:unknown[]=[])=>({rows,rowCount:rows.length})
    if (['BEGIN','COMMIT','ROLLBACK'].includes(sql)||sql.startsWith('SELECT pg_advisory')) return result()
    if (sql.includes('FROM vendor_memberships')) return result([{}])
    if (sql.includes('FROM shared_registry_bindings')) return result([{...binding,host:'a.invalid'}])
    if (sql.includes('FROM tenants')) return result([{id:request.requestId,catalog_version:'v1',catalog_tier:'core'}])
    if (sql.includes('FROM catalog_entries')) return result([{source_sha256:'a'.repeat(64),solution}])
    if (sql.includes("state IN ('running','needs_intervention')")) return result([])
    if (sql.includes('FROM shared_jobs')) return result(stored)
    if (sql.startsWith('INSERT INTO shared_jobs')) { inserts++;stored.push({id:params[0],payload_digest:params[4],state:'queued',issuer:params[5],actor_uid:params[6]});return result() }
    if (sql.startsWith('INSERT INTO audit_events')) { audits.push(params[2]); return result() }
    throw Error('unexpected_sql:'+sql)
  }}
  const pool={connect:async()=>client} as unknown as Pool
  const input={schemaVersion:1,operation:'provision',requestId:request.requestId}
  const actor={issuer:'vendor',actorUid:7}
  const first=await enqueueSharedJob(pool,request.requestId,actor,input,'Provision fixture')
  const second=await enqueueSharedJob(pool,request.requestId,actor,{...input,requestId:'81e71f13-a412-4d5d-b230-c6cd1dd45d35'},'Retry fixture')
  expect(first.id).toBe(second.id);expect(second.replay).toBe(true);expect(inserts).toBe(1)
  expect(audits).toEqual(['shared_job.queued','shared_job.replayed'])
  await expect(enqueueSharedJob(pool,request.requestId,{...actor,actorUid:8},input,'Other actor replay')).rejects.toThrow('shared_replay_forbidden')
  await expect(enqueueSharedJob(pool,request.requestId,{...actor,issuer:'other'},input,'Other issuer replay')).rejects.toThrow('shared_replay_forbidden')
  await expect(enqueueSharedJob(pool,request.requestId,actor,{...input,policy:request.policy},'Forged policy')).rejects.toThrow()
  // Changed authoritative catalog must not turn the singleton into a new effect.
  solution.base_modules.push('nasq_pmo')
  await expect(enqueueSharedJob(pool,request.requestId,actor,{...input,requestId:'81e71f13-a412-4d5d-b230-c6cd1dd45d35'},'Changed catalog replay')).rejects.toThrow('idempotency_conflict')
  expect(inserts).toBe(1)
  expect(audits).toEqual(['shared_job.queued','shared_job.replayed'])
})
it('enqueues and replays signed HTTP backup through actual store with registry-owned binding', async () => {
  const inserted:any[][]=[]
  const client={release(){},async query(sql:string,params:any[]=[]){
    const result=(rows:unknown[]=[])=>({rows,rowCount:rows.length})
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)||sql.startsWith('SELECT pg_advisory')||sql.startsWith('DELETE FROM service_nonces'))return result()
    if(sql.startsWith('INSERT INTO service_nonces'))return result([{nonce:params[1]}])
    if(sql.includes('FROM vendor_memberships'))return result([{capabilities:['vendor.operations.run']}])
    if(sql.includes('FROM tenants'))return result([{}])
    if(sql.includes('FROM shared_registry_bindings'))return result([{...binding,host:'a.invalid'}])
    if(sql.includes("state IN ('running','needs_intervention')"))return result()
    if(sql.includes('FROM shared_jobs'))return result(inserted.map(p=>({id:p[0],payload_digest:p[4],state:'queued',issuer:p[5],actor_uid:p[6]})))
    if(sql.startsWith('INSERT INTO shared_jobs')){inserted.push(params);return result()}
    if(sql.startsWith('INSERT INTO audit_events'))return result()
    throw Error('unexpected_sql:'+sql)
  }}
  const key='queue-store-integration-synthetic-key-'.repeat(2),issuer='queue-store-test'
  const server=createApp({connect:async()=>client} as unknown as Pool,{installationId:issuer,key,tenantRegistryPath:'/unused/registry.json',inventoryPath:'/unused',stateDir:'/unused',repositoryRoot:'/unused',python:'python3'})
  vi.stubEnv('NASQ_TENANCY_MODE','shared')
  try {
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
    const address=server.address();if(!address||typeof address==='string')throw Error('missing address')
    const path=`/v1/shared/tenants/${request.requestId}/jobs`
    const body=JSON.stringify({reason:'Synthetic backup request',job:{schemaVersion:1,requestId:request.requestId,operation:'backup'}})
    const send=()=>fetch(`http://127.0.0.1:${address.port}${path}`,{method:'POST',body,headers:{...signServiceRequest({method:'POST',path,body,actor:7,issuer,key}),'content-type':'application/json'}})
    const first=await send();expect(first.status).toBe(202);const accepted=await first.json()
    const second=await send();expect(second.status).toBe(200);expect(await second.json()).toEqual({...accepted,replay:true})
    expect(inserted).toHaveLength(1)
    expect(inserted[0]![3].binding).toEqual({tenantId:'a',database:'db_a',filestore:'db_a',registryRevision:1})
    expect(inserted[0]!.slice(5,7)).toEqual([issuer,7])
  } finally {vi.unstubAllEnvs();await new Promise<void>(resolve=>server.close(()=>resolve()))}
})
it('rolls back queued insertion when durable audit cannot be written', async () => {
  const rows:unknown[][]=[]
  let committed=0, rolledBack=0
  const client={release(){},async query(sql:string,params:unknown[]=[]){
    const result=(items:unknown[]=[])=>({rows:items,rowCount:items.length})
    if(sql==='BEGIN'||sql.startsWith('SELECT pg_advisory'))return result()
    if(sql==='COMMIT'){committed++;return result()}
    if(sql==='ROLLBACK'){rolledBack++;rows.length=0;return result()}
    if(sql.includes('FROM vendor_memberships')||sql.includes('FROM tenants'))return result([{}])
    if(sql.includes('FROM shared_registry_bindings'))return result([{...binding,host:'a.invalid'}])
    if(sql.includes('FROM shared_jobs'))return result()
    if(sql.startsWith('INSERT INTO shared_jobs')){rows.push(params);return result()}
    if(sql.startsWith('INSERT INTO audit_events'))throw Error('audit_storage_failure')
    throw Error('unexpected_sql:'+sql)
  }}
  await expect(enqueueSharedJob({connect:async()=>client} as unknown as Pool,request.requestId,
    {issuer:'vendor',actorUid:7},{schemaVersion:1,operation:'backup',requestId:request.requestId},'Backup audit fault'
  )).rejects.toThrow('audit_storage_failure')
  expect(rows).toEqual([]);expect(committed).toBe(0);expect(rolledBack).toBe(1)
})
it('derives policy only from published catalog module and feature definitions', () => {
  expect(deriveSharedPolicy({ base_modules: ['nasq_core'], tiers: [{ id: 'core', modules: ['nasq_pmo'], features: ['boolean:pmo.projects', 'limit:users.limit'] }] }, 'core')).toEqual({ schema_version: 1, channel: 'control_plane', modules: ['nasq_core', 'nasq_pmo'], features: { 'users.limit': null, 'storage.limit_mb': null, 'pmo.projects': true } })
  expect(() => deriveSharedPolicy({ base_modules: ['nasq_core'], tiers: [] }, 'core')).toThrow('catalog_tier_missing')
})
it('binds only trusted registry identity and derives stable provisioning key across requests', () => {
  const a = bindQueuedRequest(request, binding)
  const b = bindQueuedRequest({ ...request, requestId: '81e71f13-a412-4d5d-b230-c6cd1dd45d35' }, binding)
  expect(a.binding.tenantId).toBe('a')
  expect(businessKey(a)).toBe(businessKey(b))
  expect(payloadDigest(a)).toBe(payloadDigest(b))
})
it('rejects disabled bindings and all caller identity overrides', () => {
  expect(() => bindQueuedRequest(request, { ...binding, enabled: false })).toThrow('tenant_unavailable')
  expect(() => bindQueuedRequest({ ...request, binding }, binding)).toThrow('caller_binding_forbidden')
  expect(() => bindQueuedRequest({ ...request, businessKey: 'other' }, binding)).toThrow()
})
it('pins backup restore to exact source identity and revision', () => {
  const restore = { schemaVersion: 1, requestId: request.requestId, operation: 'restore', approvalId: '81e71f13-a412-4d5d-b230-c6cd1dd45d35', backup: { schemaVersion: 1, backupId: request.requestId, binding: { tenantId: 'foreign', database: 'db_a', filestore: 'db_a', registryRevision: 1 }, databaseSha256: 'a'.repeat(64), filestoreSha256: 'b'.repeat(64), consistency: 'verified' } }
  expect(() => bindQueuedRequest(restore, binding)).toThrow('tenant_binding_mismatch')
})

const approvalId = '1b6f9c50-93c2-4a55-b3e2-77c2cf0d1a01'
const restoreRequest = { schemaVersion: 1, requestId: '687674dc-5789-4a99-b151-12d69f010cc3', operation: 'restore', approvalId }
function restoreFixture(approval: Record<string, unknown> | null, flags: { duplicate?: boolean; reserved?: boolean } = {}) {
  const stored: Array<{ id:string; payload:any; payload_digest:string; state:string; issuer:string; actor_uid:number; business_key:string }> = []
  const audits:string[]=[]
  const client={release(){},async query(sql:string,params:any[]=[]){
    const result=(rows:unknown[]=[])=>({rows,rowCount:rows.length})
    if (['BEGIN','COMMIT','ROLLBACK'].includes(sql)||sql.startsWith('SELECT pg_advisory')) return result()
    if (sql.includes('FROM vendor_memberships')) return result([{}])
    if (sql.includes('FROM tenants')) return result([{}])
    if (sql.startsWith('SELECT 1 FROM shared_registry_hosts')) return flags.reserved ? result([{ok:1}]) : result()
    if (sql.includes('FROM shared_registry_bindings')) return result([{...binding,host:'a.invalid'}])
    if (sql.includes('FROM shared_restore_approvals')) return approval && !approval.consumed_at && approval.expires_at !== 'expired' ? result([approval]) : result()
    if (sql.includes("state IN ('running','needs_intervention')")) return result([])
    if (sql.includes("payload->>'approvalId'")) return flags.duplicate ? result([{ok:1}]) : result([])
    if (sql.includes('FROM shared_jobs')) return result(stored.filter((row)=>row.business_key===params[1]))
    if (sql.startsWith('INSERT INTO shared_jobs')) { stored.push({id:params[0],payload:params[3],payload_digest:params[4],state:'queued',issuer:params[5],actor_uid:params[6],business_key:params[2]}); return result() }
    if (sql.startsWith('INSERT INTO audit_events')) { audits.push(params[2]); return result() }
    throw Error('unexpected_sql:'+sql)
  }}
  return { pool:{connect:async()=>client} as unknown as Pool, stored, audits }
}
const approvalRow = {
  approval_tenant_id: request.requestId, backup_tenant_id: request.requestId, backup_id: request.requestId,
  target_database: 'db_new',
  tenant_id: 'a', database_name: 'db_a', filestore: 'db_a', database_sha256: 'a'.repeat(64), filestore_sha256: 'b'.repeat(64),
}
const actor={issuer:'vendor',actorUid:7}
it('derives restore payload from the durable approval inside the enqueue transaction', async () => {
  const f=restoreFixture(approvalRow)
  const result=await enqueueSharedJob(f.pool,request.requestId,actor,restoreRequest,'Approved restore')
  expect(result).toEqual({id:result.id,state:'queued',replay:false})
  expect(f.audits).toEqual(['shared_job.queued'])
  const payload=f.stored[0]!.payload
  expect(payload.binding).toEqual({tenantId:'a',database:'db_a',filestore:'db_a',registryRevision:1})
  expect(payload.backup).toEqual({schemaVersion:1,backupId:request.requestId,binding:{tenantId:'a',database:'db_a',filestore:'db_a',registryRevision:1},databaseSha256:'a'.repeat(64),filestoreSha256:'b'.repeat(64),consistency:'verified'})
  expect(payload.approvalId).toBe(approvalId)
  expect(f.stored[0]!.business_key).toBe(businessKey(payload))
  expect(f.stored[0]!.payload_digest).toBe(payloadDigest(payload))
})
it.each([
  ['missing', null],
  ['cross-tenant', { ...approvalRow, approval_tenant_id: 'ad03d956-efef-4f80-baf3-9c23ea46e945' }],
  ['foreign backup', { ...approvalRow, backup_tenant_id: 'ad03d956-efef-4f80-baf3-9c23ea46e945' }],
  ['already consumed', { ...approvalRow, consumed_at: '2026-01-01T00:00:00Z' }],
  ['expired', { ...approvalRow, expires_at: 'expired' }],
])('rejects a %s restore approval before any job is queued', async (_name,approval)=>{
  const f=restoreFixture(approval as Record<string, unknown>)
  await expect(enqueueSharedJob(f.pool,request.requestId,actor,restoreRequest,'Restore')).rejects.toThrow('shared_restore_approval_unavailable')
  expect(f.stored).toEqual([]);expect(f.audits).toEqual([])
})
it('replays an identical restore request for the same actor and rejects a different actor', async () => {
  const f=restoreFixture(approvalRow)
  const first=await enqueueSharedJob(f.pool,request.requestId,actor,restoreRequest,'Approved restore')
  const replay=await enqueueSharedJob(f.pool,request.requestId,actor,restoreRequest,'Retry restore')
  expect(replay).toEqual({...first,replay:true});expect(f.audits).toEqual(['shared_job.queued','shared_job.replayed'])
  await expect(enqueueSharedJob(f.pool,request.requestId,{...actor,actorUid:8},restoreRequest,'Other actor')).rejects.toThrow('shared_replay_forbidden')
  expect(f.stored).toHaveLength(1)
})
it('refuses a second job for an approval that is already referenced', async () => {
  const flags={duplicate:false}
  const f=restoreFixture(approvalRow,flags)
  await enqueueSharedJob(f.pool,request.requestId,actor,restoreRequest,'Approved restore')
  flags.duplicate=true
  await expect(enqueueSharedJob(f.pool,request.requestId,actor,{...restoreRequest,requestId:'81e71f13-a412-4d5d-b230-c6cd1dd45d35'},'Second restore')).rejects.toThrow('shared_restore_approval_unavailable')
  expect(f.stored).toHaveLength(1)
})
it('rejects caller-injected restore authority fields before any lookup', async () => {
  const f=restoreFixture(approvalRow)
  await expect(enqueueSharedJob(f.pool,request.requestId,actor,{...restoreRequest,binding:{tenantId:'x'}},'Injected binding')).rejects.toThrow()
  await expect(enqueueSharedJob(f.pool,request.requestId,actor,{...restoreRequest,backup:{schemaVersion:1,backupId:request.requestId,binding:{tenantId:'a',database:'db_a',filestore:'db_a',registryRevision:1},databaseSha256:'a'.repeat(64),filestoreSha256:'b'.repeat(64),consistency:'verified'}},'Injected backup')).rejects.toThrow()
  expect(f.stored).toEqual([]);expect(f.audits).toEqual([])
})
it('refuses restore enqueue without a live vendor operations grant', async () => {
  const client={release(){},async query(sql:string){
    const result=(rows:unknown[]=[])=>({rows,rowCount:rows.length})
    if (['BEGIN','COMMIT','ROLLBACK'].includes(sql)) return result()
    if (sql.includes('FROM vendor_memberships')) return result()
    if (sql.includes('FROM shared_registry_bindings')) return result([{...binding,host:'a.invalid'}])
    throw Error('unexpected_sql:'+sql)
  }}
  await expect(enqueueSharedJob({connect:async()=>client} as unknown as Pool,request.requestId,actor,restoreRequest,'Revoked grant restore')).rejects.toThrow('shared_job_forbidden')
})
const tenantTarget = (count: string) => {
  const pool={query:async(sql:string)=>sql.includes('count(*)')?{rows:[{count}],rowCount:1}:{rows:[],rowCount:0},end:async()=>{}}
  return { pool } as unknown as { pool: Pool }
}
it('refuses a restore whose approved target is registered or already carries rows, before any job exists', async () => {
  // Registered target: rejected from the control-side registry probe.
  const reserved=restoreFixture(approvalRow,{reserved:true})
  await expect(enqueueSharedJob(reserved.pool,request.requestId,actor,restoreRequest,'Reserved target')).rejects.toThrow('restore_target_reserved')
  expect(reserved.stored).toEqual([]);expect(reserved.audits).toEqual([])
  // Reachable but non-empty target: rejected from the shared emptiness check.
  const occupied=restoreFixture(approvalRow)
  await expect(enqueueSharedJob(occupied.pool,request.requestId,actor,restoreRequest,'Occupied target',{connect:async()=>tenantTarget('1')})).rejects.toThrow('restore_target_not_empty')
  expect(occupied.stored).toEqual([]);expect(occupied.audits).toEqual([])
  // A reachable, empty target still queues normally.
  const fresh=restoreFixture(approvalRow)
  const queued=await enqueueSharedJob(fresh.pool,request.requestId,actor,restoreRequest,'Fresh target',{connect:async()=>tenantTarget('0')})
  expect(queued.state).toBe('queued');expect(fresh.stored).toHaveLength(1)
})
