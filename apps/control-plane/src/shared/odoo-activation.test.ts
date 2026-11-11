import {expect,it,vi} from 'vitest'
import type {Pool} from 'pg'
import {reconcileOdooOnboardings} from './odoo-adapter.js'
import {bindJob,businessKey,payloadDigest} from './provisioning.js'
const id='ba91699b-c25b-4a01-8c84-b2d39dc4b873'
const job=bindJob({schemaVersion:1,operation:'provision',requestId:id,binding:{tenantId:'ta',database:'liwan_scratch_'+'a'.repeat(32),filestore:'liwan_scratch_'+'a'.repeat(32),registryRevision:1},catalog:{version:'v1',tier:'projects',sourceSha256:'a'.repeat(64)},policy:{schema_version:1,channel:'control_plane',modules:['liwan_core'],features:{'users.limit':null,'storage.limit_mb':null,'pmo.enabled':true}}})
function fixture(enabled:boolean){
  const flags={quarantined:false,lostCas:false,badEvidence:false}
  const result=(rows:unknown[]=[])=>({rows,rowCount:rows.length})
  const writes:Array<{sql:string;params:unknown[]}>=[]
  const row={payload:job,issuer:'vendor:vendor-account',actor_uid:7,job_digest:payloadDigest(job),request_id:id,control_tenant_id:id,job_id:id,recheck_failures:0}
  const client={release(){},async query(sql:string,params:unknown[]=[]){
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return result()
    if(sql.includes('FROM vendor_accounts WHERE id'))return result([{}])
    if(sql.includes('FROM vendor_account_roles'))return result([{role:'customer_success'},{role:'operations'}])
    if(sql.includes('FROM tenants'))return result(enabled?[{id}]:[])
    if(sql.includes('FROM shared_onboardings') && sql.includes('FOR UPDATE'))return result([{...row,stage:flags.quarantined?'needs_intervention':'activating'}])
    if(sql.includes('FROM shared_jobs'))return result(flags.badEvidence && sql.includes('JOIN shared_registry_bindings')?[]:[{}])
    if(sql.startsWith('UPDATE')){writes.push({sql,params});return result(sql.includes("SET stage='active'") && (flags.quarantined || flags.lostCas)?[]:[{}])}
    throw Error('unexpected SQL:'+sql)
  }}
  const pool={connect:async()=>client,async query(sql:string,params:unknown[]=[]){
    if(sql.includes('FROM shared_onboardings'))return {rows:[row]}
    if(sql.includes('FROM shared_registry_bindings'))return {rows:[{enabled:true,revision:2}]}
    if(sql.startsWith('UPDATE')){writes.push({sql,params});return result()}
    throw Error('unexpected SQL:'+sql)
  }} as unknown as Pool
  const adapter={observe:async()=>({state:'present',binding:job.binding,businessKey:businessKey(job),payloadDigest:payloadDigest(job),verified:true}),applyFenced:async()=>{throw Error('read-only activation')}}
  return {pool,adapter,writes,flags}
}
it('refuses activation when tenant operations were disabled after physical verification',async()=>{
  const f=fixture(false)
  const log=vi.fn()
  await reconcileOdooOnboardings(f.pool,{tenantRegistryPath:'/nonexistent/shared-test-registry.json'} as any,f.adapter,log)
  expect(log).toHaveBeenCalledWith(`onboarding reconcile failed for ${id}`,expect.objectContaining({message:'tenant_operations_unavailable'}))
  expect(f.writes).toHaveLength(1)
  expect(f.writes[0]!.params).toEqual([id,1,30])
})
it('persists the flat feature map used by tenant HTTP/UI policy fields',async()=>{
  const f=fixture(true)
  await reconcileOdooOnboardings(f.pool,{tenantRegistryPath:'/nonexistent/shared-test-registry.json'} as any,f.adapter,vi.fn())
  const write=f.writes.find(entry=>entry.sql.startsWith("UPDATE tenants SET status='active'"))!
  expect(write.params[1]).toEqual(job.operation==='provision'?job.policy.features:null)
  expect(write.params[1]).not.toHaveProperty('modules')
})

it('quarantines a full failed batch so the healthy eleventh tenant activates next tick',async()=>{
  const rows=Array.from({length:11},(_,index)=>{
    const uuid=`ba91699b-c25b-4a01-8c84-${String(index).padStart(12,'0')}`
    const binding={...job.binding,tenantId:`tenant${index}`,database:`liwan_scratch_${String(index).padStart(32,'0')}`,filestore:`liwan_scratch_${String(index).padStart(32,'0')}`}
    const payload=bindJob({...job,requestId:uuid,binding})
    return {payload,issuer:'vendor:vendor-account',actor_uid:7,job_digest:payloadDigest(payload),request_id:uuid,control_tenant_id:uuid,job_id:uuid,stage:'verifying',recheck_failures:0}
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
    if(candidate.requestId!==rows[10]!.request_id)return {state:'absent'}
    return {state:'present',binding:candidate.binding,businessKey:businessKey(candidate),payloadDigest:payloadDigest(candidate),verified:true}
  },applyFenced:async()=>{throw Error('read-only activation')}}
  const config={tenantRegistryPath:'/nonexistent/shared-test-registry.json'} as any
  await reconcileOdooOnboardings(pool,config,adapter,vi.fn())
  expect(rows.slice(0,10).every(row=>row.stage==='needs_intervention')).toBe(true)
  expect(rows[10]!.stage).toBe('verifying')
  await reconcileOdooOnboardings(pool,config,adapter,vi.fn())
  expect(rows[10]!.stage).toBe('active')
  expect(observed).toHaveLength(11)
})

function recheckFixture(recheckFailures:number,observation:unknown,log=vi.fn()){
  const writes:Array<{sql:string;params:unknown[]}>=[]
  const client={release(){},async query(sql:string,params:unknown[]=[]){
    if(sql.startsWith('UPDATE'))writes.push({sql,params})
    return {rowCount:1,rows:[{}]}
  }}
  const row={payload:job,issuer:'vendor:vendor-account',actor_uid:7,job_digest:payloadDigest(job),request_id:id,control_tenant_id:id,job_id:id,recheck_failures:recheckFailures}
  const pool={connect:async()=>client,async query(sql:string,params:unknown[]=[]){
    if(sql.startsWith('UPDATE'))writes.push({sql,params})
    return {rows:[row]}
  }} as unknown as Pool
  const observe=async()=>{if(observation instanceof Error)throw observation;return observation}
  const run=()=>reconcileOdooOnboardings(pool,{} as any,{observe,applyFenced:async()=>{throw Error('read-only activation')}} as any,log)
  return {writes,run,log}
}

it('an unreadable recheck backs the candidate off without quarantining it or touching the tenant',async()=>{
  const f=recheckFixture(0,{state:'unknown'})
  await f.run()
  expect(f.writes).toHaveLength(1)
  expect(f.writes[0]!.sql).toContain('recheck_failures=$2')
  expect(f.writes[0]!.sql).toContain('recheck_after')
  expect(f.writes[0]!.sql).not.toContain('needs_intervention')
  expect(f.writes[0]!.params).toEqual([id,1,30])
})

it('the unreadable backoff doubles with each failure',async()=>{
  const f=recheckFixture(2,{state:'unknown'})
  await f.run()
  expect(f.writes[0]!.params).toEqual([id,3,120])
})

it('the last allowed unreadable recheck quarantines with a code that says it was unreadable',async()=>{
  const f=recheckFixture(4,{state:'unknown'})
  await f.run()
  expect(f.writes[0]!.sql).toContain("stage='needs_intervention'")
  expect(f.writes[0]!.params).toEqual([id,'readiness_recheck_unreadable'])
  expect(f.writes[1]!.sql).toContain("status='needs_intervention'")
})

it.each([{state:'absent'},{state:'partial'}])('a definitive mismatch %j quarantines at once, whatever the failure count',async observation=>{
  const f=recheckFixture(0,observation)
  await f.run()
  expect(f.writes[0]!.params).toEqual([id,'readiness_recheck_failed'])
  expect(f.writes[1]!.sql).toContain("status='needs_intervention'")
})

it('an unexpected error is logged with its stack and counts as a failed recheck that backs off',async()=>{
  const boom=Error('adapter exploded')
  const f=recheckFixture(1,boom)
  await f.run()
  expect(f.log).toHaveBeenCalledWith(`onboarding reconcile failed for ${id}`,boom)
  expect(f.writes).toHaveLength(1)
  expect(f.writes[0]!.sql).not.toContain('needs_intervention')
  expect(f.writes[0]!.params).toEqual([id,2,60])
})
it('an unexpected error that fails five times in a row quarantines with a code distinct from the unreadable one',async()=>{
  const f=recheckFixture(4,Error('adapter exploded'))
  await f.run()
  expect(f.writes[0]!.sql).toContain("stage='needs_intervention'")
  expect(f.writes[0]!.params).toEqual([id,'readiness_recheck_errored'])
  expect(f.writes[1]!.sql).toContain("status='needs_intervention'")
})
it('an observation the contract rejects is an unexpected error, not a silent retry',async()=>{
  const f=recheckFixture(4,{state:'nonsense'})
  await f.run()
  expect(f.writes[0]!.params).toEqual([id,'readiness_recheck_errored'])
})
it('a transient database error backs the candidate off without counting toward quarantine',async()=>{
  const f=recheckFixture(4,Object.assign(Error('db restarting'),{code:'57P01'}))
  await f.run()
  expect(f.writes).toHaveLength(1)
  expect(f.writes[0]!.sql).not.toContain('needs_intervention')
  expect(f.writes[0]!.params).toEqual([id,4,240])
})
it('a failure that cannot be recorded is logged and does not stop the pass',async()=>{
  const pool={connect:async()=>{throw Error('no connection')},async query(sql:string){if(sql.startsWith('UPDATE'))throw Error('db write failed');return {rows:[{payload:job,issuer:'vendor:vendor-account',actor_uid:7,job_digest:payloadDigest(job),request_id:id,control_tenant_id:id,job_id:id,recheck_failures:0}]}}} as unknown as Pool
  const log=vi.fn()
  await reconcileOdooOnboardings(pool,{} as any,{observe:async()=>{throw Error('adapter exploded')},applyFenced:async()=>{throw Error('x')}} as any,log)
  expect(log).toHaveBeenCalledWith(`onboarding reconcile could not record the failure for ${id}`,expect.objectContaining({message:'db write failed'}))
})
it('does not mark tenant active after another reconciler quarantines the onboarding',async()=>{
  const f=fixture(true)
  f.flags.quarantined=true
  await reconcileOdooOnboardings(f.pool,{tenantRegistryPath:'/nonexistent/shared-test-registry.json'} as any,f.adapter,vi.fn())
  expect(f.writes.some(entry=>entry.sql.startsWith("UPDATE tenants SET status='active'"))).toBe(false)
})
it('does not mark tenant active when final stage CAS updates no row',async()=>{
  const f=fixture(true)
  f.flags.lostCas=true
  const log=vi.fn()
  await reconcileOdooOnboardings(f.pool,{tenantRegistryPath:'/nonexistent/shared-test-registry.json'} as any,f.adapter,log)
  expect(log).toHaveBeenCalledWith(`onboarding reconcile failed for ${id}`,expect.objectContaining({message:'shared_activation_state_changed'}))
  expect(f.writes.find(entry=>entry.sql.includes("stage='needs_intervention'"))!.params).toEqual([id,'shared_activation_state_changed'])
  expect(f.writes.some(entry=>entry.sql.startsWith("UPDATE tenants SET status='active'"))).toBe(false)
})
it('requires the durable verified receipt and enabled exact published binding again under final locks',async()=>{
  const f=fixture(true)
  f.flags.badEvidence=true
  const log=vi.fn()
  await reconcileOdooOnboardings(f.pool,{tenantRegistryPath:'/nonexistent/shared-test-registry.json'} as any,f.adapter,log)
  expect(log).toHaveBeenCalledWith(`onboarding reconcile failed for ${id}`,expect.objectContaining({message:'shared_verification_lost'}))
  expect(f.writes.find(entry=>entry.sql.includes("stage='needs_intervention'"))!.params).toEqual([id,'shared_verification_lost'])
  expect(f.writes.some(entry=>entry.sql.startsWith("UPDATE tenants SET status='active'"))).toBe(false)
})

it('logs one candidate\'s unexpected error, counts and holds it back and still reconciles the next candidate',async()=>{
  const second='ba91699b-c25b-4a01-8c84-000000000002'
  const secondJob=bindJob({...job,requestId:second,binding:{...job.binding,tenantId:'tb',database:'liwan_scratch_'+'b'.repeat(32),filestore:'liwan_scratch_'+'b'.repeat(32)}})
  const rows=[
    {payload:job,issuer:'vendor:vendor-account',actor_uid:7,job_digest:payloadDigest(job),request_id:id,control_tenant_id:id,job_id:id,recheck_failures:0},
    {payload:secondJob,issuer:'vendor:vendor-account',actor_uid:7,job_digest:payloadDigest(secondJob),request_id:second,control_tenant_id:second,job_id:second,recheck_failures:0},
  ]
  const held:unknown[][]=[]
  const quarantined:unknown[][]=[]
  const client={release(){},async query(sql:string,params:unknown[]=[]){
    if(sql.startsWith('UPDATE shared_onboardings'))quarantined.push(params)
    return {rowCount:1,rows:[{}]}
  }}
  const pool={connect:async()=>client,async query(sql:string,params:unknown[]=[]){
    if(sql.startsWith('UPDATE shared_onboardings SET recheck_failures')){held.push(params);return {rowCount:1,rows:[]}}
    return {rows}
  }} as unknown as Pool
  const observed:string[]=[]
  const adapter={observe:async(candidate:typeof job)=>{
    observed.push(candidate.requestId)
    if(candidate.requestId===id)throw Error('observe_exploded')
    return {state:'absent'}
  },applyFenced:async()=>{throw Error('read-only activation')}} as any
  const log=vi.fn()
  await reconcileOdooOnboardings(pool,{} as any,adapter,log)
  expect(observed).toEqual([id,second])
  expect(log).toHaveBeenCalledWith(`onboarding reconcile failed for ${id}`,expect.objectContaining({message:'observe_exploded'}))
  expect(held).toEqual([[id,1,30]])
  expect(quarantined).toContainEqual([second,'readiness_recheck_failed'])
})
