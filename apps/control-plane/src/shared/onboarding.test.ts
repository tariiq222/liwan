import { describe, expect, it } from 'vitest'
import { sharedOnboardingRequestSchema } from '@nasq/commercial-contracts'
import { onboardingIdentity, assertOnboardingReplay } from './onboarding.js'
import { parseSharedRuntimeConfig } from './runtime-config.js'
const input = {request_id:'ba91699b-c25b-4a01-8c84-b2d39dc4b873',name:'Example',catalog_version:'v1',catalog_tier:'projects',admin_name:'Administrator',admin_login:'admin@example.test',reason:'Create first customer'}
const actor={issuer:'vendor:vendor-account',actorUid:7}
describe('shared onboarding identity',()=>{
  it('derives stable scratch resources, ignoring no caller authority',()=>{
    const first=onboardingIdentity(input,'local.test')
    expect(onboardingIdentity(input,'local.test')).toEqual(first)
    expect(first.database).toMatch(/^nasq_scratch_[a-f0-9]{32}$/)
    expect(first.host).toBe(`${first.slug}.local.test`)
    expect(sharedOnboardingRequestSchema.safeParse({...input,password:'secret'}).success).toBe(false)
  })
  it('accepts identical replay and rejects changed administrator or actor',()=>{
    const identity=onboardingIdentity(input,'local.test')
    const row={issuer:actor.issuer,actor_uid:actor.actorUid,request_digest:identity.digest}
    expect(()=>assertOnboardingReplay(row,actor,identity.digest)).not.toThrow()
    expect(()=>assertOnboardingReplay(row,{...actor,actorUid:8},identity.digest)).toThrow('shared_replay_forbidden')
    expect(()=>assertOnboardingReplay(row,actor,onboardingIdentity({...input,admin_login:'other@example.test'},'local.test').digest)).toThrow('idempotency_conflict')
  })
})
it('requires explicit validated local runtime paths and bounded project identity',()=>{
  const value={schemaVersion:1,projectName:'nasq-saas-acceptance',composeFile:'/scratch/compose.yml',envFile:'/scratch/runtime.env',stateDir:'/scratch/state',domainSuffix:'local.test'}
  expect(parseSharedRuntimeConfig(value)).toEqual(value)
  for(const extra of [{projectName:'prod'}, {composeFile:'relative'}, {domainSuffix:'https://evil'}, {command:'sh'}])expect(()=>parseSharedRuntimeConfig({...value,...extra})).toThrow()
})

import { resolveProvisionTarget } from './onboarding.js'
import { reconcileOdooOnboardings } from './odoo-adapter.js'
import {bindJob,payloadDigest} from './provisioning.js'
import type {Pool,PoolClient} from 'pg'
const job=bindJob({schemaVersion:1,operation:'provision',requestId:input.request_id,binding:{tenantId:'ta',database:'nasq_scratch_'+'a'.repeat(32),filestore:'nasq_scratch_'+'a'.repeat(32),registryRevision:1},catalog:{version:'v1',tier:'projects',sourceSha256:'a'.repeat(64)},policy:{schema_version:1,channel:'control_plane',modules:['nasq_core'],features:{'users.limit':null,'storage.limit_mb':null}}})
it('disabled routing exception requires exact durable onboarding digest, and never changes the registry',async()=>{
  let eligible=false
  const calls:string[]=[]
  const client={async query(sql:string,params:unknown[]){
    calls.push(sql)
    if(sql.includes('FROM shared_registry_bindings'))return {rowCount:1,rows:[{...job.binding,host:'ta.example.test',enabled:false}]}
    expect(params[1]).toBe(input.request_id);expect(params[2]).toBe(payloadDigest(job))
    return {rowCount:eligible?1:0,rows:eligible?[{}]:[]}
  }} as unknown as PoolClient
  expect((await resolveProvisionTarget(client,input.request_id,job)).enabled).toBe(false)
  eligible=true
  expect((await resolveProvisionTarget(client,input.request_id,job)).enabled).toBe(true)
  expect(calls.every(sql=>sql.startsWith('SELECT'))).toBe(true)
})
it.each([{state:'unknown'},{state:'partial'},{state:'present',binding:job.binding,businessKey:'foreign',payloadDigest:payloadDigest(job),verified:true}])('does not activate from incomplete or foreign real evidence %j',async observation=>{
  let calls=0
  const writes:string[]=[]
  const client={release(){},async query(sql:string){if(sql.startsWith('UPDATE'))writes.push(sql);return {rows:[]}}}
  const pool={connect:async()=>client,async query(){calls++;return {rows:[{payload:job,issuer:'vendor:vendor-account',actor_uid:7,job_digest:payloadDigest(job)}]}}} as unknown as Pool
  await reconcileOdooOnboardings(pool,{} as any,{observe:async()=>observation,applyFenced:async()=>{throw Error('must never mutate in reconcile')}})
  expect(calls).toBe(1)
  expect(writes[0]).toContain("stage='needs_intervention',error_code='readiness_recheck_failed'")
  expect(writes[1]).toContain("status='needs_intervention'")
})

import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, vi } from 'vitest'
import { onboardSharedTenant } from './onboarding.js'
describe('Track A is retired for new shared onboarding (owner decision O1)',()=>{
  const packageInput={request_id:input.request_id,name:'Example',package_revision_id:'11111111-1111-4111-8111-111111111111',admin_name:'Administrator',admin_login:'admin@example.test',reason:'Create first customer'}
  let config:never
  let previousMode:string|undefined
  beforeEach(()=>{
    const root=realpathSync(mkdtempSync(join(tmpdir(),'nasq-onboarding-test-')))
    mkdirSync(join(root,'state'))
    writeFileSync(join(root,'compose.yml'),'');writeFileSync(join(root,'runtime.env'),'')
    const runtime=join(root,'runtime.json')
    writeFileSync(runtime,JSON.stringify({schemaVersion:1,projectName:'nasq-saas-acceptance',composeFile:join(root,'compose.yml'),envFile:join(root,'runtime.env'),stateDir:join(root,'state'),domainSuffix:'local.test'}))
    config={sharedRuntimeConfigPath:runtime,tenantRegistryPath:join(root,'registry.json'),repositoryRoot:root} as never
    previousMode=process.env.NASQ_TENANCY_MODE;process.env.NASQ_TENANCY_MODE='shared'
  })
  afterEach(()=>{if(previousMode===undefined)delete process.env.NASQ_TENANCY_MODE;else process.env.NASQ_TENANCY_MODE=previousMode})
  function fakePool(existing:unknown[]){
    const sql:string[]=[]
    const reply=async(text:string)=>{
      sql.push(text)
      if(text.includes('FROM vendor_accounts WHERE id'))return {rowCount:1,rows:[{}]}
      if(text.includes('FROM vendor_account_roles'))return {rowCount:2,rows:[{role:'customer_success'},{role:'operations'}]}
      if(text.includes('SELECT * FROM shared_onboardings'))return {rowCount:existing.length,rows:existing}
      return {rowCount:1,rows:[{tenant_id:input.request_id,job_id:'job-1',status:'provisioning',host:'h.local.test'}]}
    }
    const client={query:vi.fn(reply),release:vi.fn()}
    return {sql,pool:{connect:async()=>client,query:vi.fn(reply)} as never}
  }
  it('refuses a new package_revision_id request with 410 package_retired before any write',async()=>{
    const {pool,sql}=fakePool([])
    await expect(onboardSharedTenant(pool,config,actor,packageInput)).rejects.toMatchObject({status:410,code:'package_retired',field:'package_revision_id'})
    expect(sql.some(text=>/INSERT INTO|UPDATE \w+ SET/.test(text))).toBe(false)
  })
  it('still replays an already accepted request instead of answering 410',async()=>{
    const identity=onboardingIdentity(packageInput,'local.test')
    const {pool,sql}=fakePool([{issuer:actor.issuer,actor_uid:actor.actorUid,request_digest:identity.digest}])
    await expect(onboardSharedTenant(pool,config,actor,packageInput)).resolves.toMatchObject({replay:true,tenant_id:input.request_id})
    expect(sql.some(text=>text.includes('INSERT INTO tenants'))).toBe(false)
  })
})
