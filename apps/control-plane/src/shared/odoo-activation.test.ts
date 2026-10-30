import {expect,it} from 'vitest'
import type {Pool} from 'pg'
import {reconcileOdooOnboardings} from './odoo-adapter.js'
import {bindJob,businessKey,payloadDigest} from './provisioning.js'
const id='ba91699b-c25b-4a01-8c84-b2d39dc4b873'
const job=bindJob({schemaVersion:1,operation:'provision',requestId:id,binding:{tenantId:'ta',database:'liwan_scratch_'+'a'.repeat(32),filestore:'liwan_scratch_'+'a'.repeat(32),registryRevision:1},catalog:{version:'v1',tier:'projects',sourceSha256:'a'.repeat(64)},policy:{schema_version:1,channel:'control_plane',modules:['liwan_core'],features:{'users.limit':null,'storage.limit_mb':null,'pmo.enabled':true}}})
function fixture(enabled:boolean){
  const flags={quarantined:false,lostCas:false,badEvidence:false}
  const writes:Array<{sql:string;params:unknown[]}>=[]
  const row={payload:job,issuer:'vendor:vendor-account',actor_uid:7,job_digest:payloadDigest(job),request_id:id,control_tenant_id:id,job_id:id}
  const client={release(){},async query(sql:string,params:unknown[]=[]){
    const result=(rows:unknown[]=[])=>({rows,rowCount:rows.length})
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return result()
    if(sql.includes('FROM vendor_accounts WHERE id'))return result([{}])
    if(sql.includes('FROM vendor_account_roles'))return result([{role:'customer_success'},{role:'operations'}])
    if(sql.includes('FROM tenants'))return result(enabled?[{id}]:[])
    if(sql.includes('FROM shared_onboardings') && sql.includes('FOR UPDATE'))return result([{...row,stage:flags.quarantined?'needs_intervention':'activating'}])
    if(sql.includes('FROM shared_jobs'))return result(flags.badEvidence && sql.includes('JOIN shared_registry_bindings')?[]:[{}])
    if(sql.startsWith('UPDATE')){writes.push({sql,params});return result(sql.includes("SET stage='active'") && (flags.quarantined || flags.lostCas)?[]:[{}])}
    throw Error('unexpected SQL:'+sql)
  }}
  const pool={connect:async()=>client,async query(sql:string){
    if(sql.includes('FROM shared_onboardings'))return {rows:[row]}
    if(sql.includes('FROM shared_registry_bindings'))return {rows:[{enabled:true,revision:2}]}
    throw Error('unexpected SQL:'+sql)
  }} as unknown as Pool
  const adapter={observe:async()=>({state:'present',binding:job.binding,businessKey:businessKey(job),payloadDigest:payloadDigest(job),verified:true}),applyFenced:async()=>{throw Error('read-only activation')}}
  return {pool,adapter,writes,flags}
}
it('refuses activation when tenant operations were disabled after physical verification',async()=>{
  const f=fixture(false)
  await expect(reconcileOdooOnboardings(f.pool,{tenantRegistryPath:'/nonexistent/shared-test-registry.json'} as any,f.adapter)).rejects.toThrow('tenant_operations_unavailable')
  expect(f.writes).toEqual([])
})
it('persists the flat feature map used by tenant HTTP/UI policy fields',async()=>{
  const f=fixture(true)
  await reconcileOdooOnboardings(f.pool,{tenantRegistryPath:'/nonexistent/shared-test-registry.json'} as any,f.adapter)
  const write=f.writes.find(entry=>entry.sql.startsWith("UPDATE tenants SET status='active'"))!
  expect(write.params[1]).toEqual(job.operation==='provision'?job.policy.features:null)
  expect(write.params[1]).not.toHaveProperty('modules')
})

it('quarantines a full failed batch so the healthy eleventh tenant activates next tick',async()=>{
  const rows=Array.from({length:11},(_,index)=>{
    const uuid=`ba91699b-c25b-4a01-8c84-${String(index).padStart(12,'0')}`
    const binding={...job.binding,tenantId:`tenant${index}`,database:`liwan_scratch_${String(index).padStart(32,'0')}`,filestore:`liwan_scratch_${String(index).padStart(32,'0')}`}
    const payload=bindJob({...job,requestId:uuid,binding})
    return {payload,issuer:'vendor:vendor-account',actor_uid:7,job_digest:payloadDigest(payload),request_id:uuid,control_tenant_id:uuid,job_id:uuid,stage:'verifying'}
  })
  const observed:string[]=[]
  const client={release(){},async query(sql:string,params:unknown[]=[]){
    if(sql.includes('FROM shared_onboardings') && sql.includes('FOR UPDATE')) {
      const row=rows.find(item=>item.request_id===params[0])!
      return {rowCount:1,rows:[row]}
    }
    if(sql.startsWith('UPDATE shared_onboardings')){
      const row=rows.find(item=>item.request_id===params[0])!
      row.stage=sql.includes("stage='needs_intervention'")?'needs_intervention':sql.includes("SET stage='active'")?'active':'activating'
    }
    if(sql.includes('FROM vendor_account_roles'))return {rowCount:2,rows:[{role:'customer_success'},{role:'operations'}]}
    return {rowCount:1,rows:[{}]}
  }}
  const pool={connect:async()=>client,async query(sql:string){
    if(sql.includes('FROM shared_onboardings'))return {rows:rows.filter(row=>['queued','verifying','activating'].includes(row.stage)).slice(0,10)}
    if(sql.includes('FROM shared_registry_bindings'))return {rows:[{enabled:true,revision:2}]}
    throw Error('unexpected SQL:'+sql)
  }} as unknown as Pool
  const adapter={observe:async(candidate:typeof job)=>{
    observed.push(candidate.requestId)
    if(candidate.requestId!==rows[10]!.request_id)return {state:'unknown'}
    return {state:'present',binding:candidate.binding,businessKey:businessKey(candidate),payloadDigest:payloadDigest(candidate),verified:true}
  },applyFenced:async()=>{throw Error('read-only activation')}}
  const config={tenantRegistryPath:'/nonexistent/shared-test-registry.json'} as any
  await reconcileOdooOnboardings(pool,config,adapter)
  expect(rows.slice(0,10).every(row=>row.stage==='needs_intervention')).toBe(true)
  expect(rows[10]!.stage).toBe('verifying')
  await reconcileOdooOnboardings(pool,config,adapter)
  expect(rows[10]!.stage).toBe('active')
  expect(observed).toHaveLength(11)
})

it('does not mark tenant active after another reconciler quarantines the onboarding',async()=>{
  const f=fixture(true)
  f.flags.quarantined=true
  await reconcileOdooOnboardings(f.pool,{tenantRegistryPath:'/nonexistent/shared-test-registry.json'} as any,f.adapter)
  expect(f.writes.some(entry=>entry.sql.startsWith("UPDATE tenants SET status='active'"))).toBe(false)
})
it('does not mark tenant active when final stage CAS updates no row',async()=>{
  const f=fixture(true)
  f.flags.lostCas=true
  await expect(reconcileOdooOnboardings(f.pool,{tenantRegistryPath:'/nonexistent/shared-test-registry.json'} as any,f.adapter)).rejects.toThrow('shared_activation_state_changed')
  expect(f.writes.some(entry=>entry.sql.startsWith("UPDATE tenants SET status='active'"))).toBe(false)
})
it('requires the durable verified receipt and enabled exact published binding again under final locks',async()=>{
  const f=fixture(true)
  f.flags.badEvidence=true
  await expect(reconcileOdooOnboardings(f.pool,{tenantRegistryPath:'/nonexistent/shared-test-registry.json'} as any,f.adapter)).rejects.toThrow('shared_verification_lost')
  expect(f.writes.some(entry=>entry.sql.startsWith("UPDATE tenants SET status='active'"))).toBe(false)
})
