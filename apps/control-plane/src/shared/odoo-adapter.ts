import { provisioningActor } from './commercial-enrollment-authority.js'
import { resolvePackageJobAuthority,assertPackageJobAuthority } from '../packages.js'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { assertReconfigureAuthority, type SubscriptionRunner } from './subscription-reconfigure.js'
import type { ObserveRunner } from './subscription-reconcile.js'
import type { Pool } from 'pg'
import type { SharedJob } from '@nasq/commercial-contracts/shared'
import { sharedObservationSchema } from '@nasq/commercial-contracts/shared'
import type { Config } from '../config.js'
import { transaction } from '../db.js'
import { businessKey,payloadDigest } from './provisioning.js'
import { loadSharedRuntimeConfig } from './runtime-config.js'
import type { SharedFencedAdapter } from './job-worker.js'
import { requireOnboardingAuthority } from './onboarding.js'
import { requireJobAuthority } from './job-store.js'
import { publishRegistryMutation, recoverRegistry } from './registry-store.js'
import { lstat } from 'node:fs/promises'
import { resolveOdooBackupAuthority,recordOdooBackup } from './odoo-backup.js'

/** Non-secret refusal codes the provision effect may report; all others are opaque.
 * Mirrors tools/nasq_cli/managed_verify.py ERROR_CODES plus the managed-policy
 * and catalog-source codes classify_error allows across the IPC boundary. */
export const PROVISION_ERROR_CODES=new Set(['target_mismatch','profile_invalid','classification_conflict','policy_already_initialized','modules_mismatch','features_mismatch','snapshot_invalid','policy_script_failed','catalog_source_unavailable','catalog_source_ambiguous','policy_invalid','policy_too_large','policy_duplicate_key','policy_channel_mismatch','commercial_mode_unsupported','catalog_reference_invalid','catalog_unavailable','catalog_digest_mismatch','catalog_invalid','policy_composition_mismatch','package_authority_invalid','package_authority_mismatch'])

/** Non-reclaimable physical reservation + current durable claim per stage.
 * Losing the control connection cancels the owned child and cannot activate.
 * Unknown physical state always remains quarantined. */
export function createOdooAdapter(pool:Pool,config:Config,signal:AbortSignal):SharedFencedAdapter & Required<import('../commercial/invitation-odoo.js').OdooPasswordAdapter> {
  if(!config.sharedRuntimeConfigPath || !config.tenantRegistryPath)throw Error('shared_adapter_unavailable')
  const runtime=loadSharedRuntimeConfig(config.sharedRuntimeConfigPath)
  const execute=async(job:SharedJob,action:'observe'|'apply',claim?:{attemptId:string;fence:number;assertOwned:()=>Promise<void>})=>{
    const packageAuthority=job.operation==='provision'?await resolvePackageJobAuthority(pool,job):undefined
    const authority=job.operation==='provision'?null:await resolveOdooBackupAuthority(pool,runtime,job,{starting:action==='apply'})
    const onboarding=job.operation==='provision'?await pool.query(`SELECT o.admin_name,o.admin_login,o.issuer,o.actor_uid,o.request_id,t.name FROM shared_onboardings o
      JOIN tenants t ON t.id=o.control_tenant_id JOIN shared_jobs j ON j.id=o.job_id
      WHERE o.request_id=$1 AND o.job_digest=$2 AND j.payload_digest=o.job_digest AND o.tenant_slug=$3 AND o.database_name=$4`,[job.requestId,payloadDigest(job),job.binding.tenantId,job.binding.database]):null
    if(job.operation==='provision' && !onboarding?.rowCount)throw Error('shared_onboarding_missing')
    const row=onboarding?.rows[0]
    const assertCurrent = async () => {
      if(!claim)throw Error('shared_claim_missing')
      await claim.assertOwned()
      if(job.operation==='provision'){
        await transaction(pool,client=>requireOnboardingAuthority(client,provisioningActor(config,row)))
        const current=await resolvePackageJobAuthority(pool,job)
        if(packageAuthority)assertPackageJobAuthority(current,packageAuthority)
      }
      else {
        const current=await resolveOdooBackupAuthority(pool,runtime,job)
        if(JSON.stringify(current)!==JSON.stringify(authority))throw Error('shared_effect_authority_changed')
        await transaction(pool,client=>requireJobAuthority(client,current.controlTenantId,current.actor))
      }
    }
    if(signal.aborted)throw Error('shared_worker_stopping')
    return new Promise<unknown>((resolve,reject)=>{
      const child=spawn(config.python,['-B','-m',job.operation==='provision'?'tools.shared_saas_lifecycle.odoo_effect':'tools.shared_saas_lifecycle.odoo_backup'],{cwd:config.repositoryRoot,stdio:['pipe','pipe','ignore'],env:{...process.env,PYTHONUNBUFFERED:'1'}})
      let buffer='',result:unknown,failed=false,checking=false,chain=Promise.resolve(),errorCode:string|undefined
      const fail=()=>{if(!failed){failed=true;child.kill('SIGTERM')}}
      const timeout=setTimeout(fail,30*60*1000)
      const abort=()=>fail()
      signal.addEventListener('abort',abort,{once:true})
      const heartbeat=setInterval(()=>{
        if(!claim || checking || failed)return
        checking=true
        assertCurrent().catch(fail).finally(()=>{checking=false})
      },15000)
      child.on('error',()=>{failed=true})
      child.stdin.on('error',fail)
      child.stdout.on('data',chunk=>{
        buffer+=String(chunk)
        if(buffer.length>65536){fail();return}
        let newline:number
        while((newline=buffer.indexOf('\n'))>=0){
          const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1)
          chain=chain.then(async()=>{
            if(failed)return
            const message=JSON.parse(line)
            if(message.permit){
              const stages=job.operation==='provision'?['runtime','reserve','install','policy','password','admin','complete','release']:job.operation==='backup'?['runtime','reserve','drain','capture','resume','complete','release']:['runtime','reserve','restore-database','restore-filestore','verify','complete','release']
              if(!claim || !stages.includes(message.permit))throw Error('shared_protocol_invalid')
              await assertCurrent()
              if(job.operation==='restore' && ['runtime','reserve','restore-database'].includes(message.permit))await resolveOdooBackupAuthority(pool,runtime,job,{starting:true})
              if(job.operation==='provision' && ['policy','password','admin','complete'].includes(message.permit)) await pool.query("UPDATE shared_onboardings SET stage='verifying' WHERE request_id=$1 AND stage IN ('queued','verifying')",[job.requestId])
              if(failed || signal.aborted)throw Error('shared_lease_lost')
              child.stdin.write(JSON.stringify({proceed:true})+'\n')
            }else if(Object.hasOwn(message,'result')){if(result!==undefined)throw Error('shared_protocol_invalid');result=message.result}
            else if(Object.keys(message).length===1 && typeof message.error_code==='string'){
              // Only allowlisted non-secret refusal codes surface; anything else stays opaque.
              errorCode=PROVISION_ERROR_CODES.has(message.error_code)?message.error_code:'shared_effect_unverified'
              failed=true;child.kill('SIGTERM')
            }
            else throw Error('shared_effect_unverified')
          }).catch(fail)
        }
      })
      child.on('close',code=>{
        clearTimeout(timeout);clearInterval(heartbeat);signal.removeEventListener('abort',abort)
        void chain.then(()=>{
          if(errorCode)reject(Error(errorCode))
          else if(failed || code!==0 || result===undefined)reject(Error('shared_effect_unverified'))
          else resolve(result)
        })
      })
      child.stdin.write(JSON.stringify({action,config:runtime,job,businessKey:businessKey(job),payloadDigest:payloadDigest(job),...(job.operation==='provision'?{admin:{name:row.admin_name,login:row.admin_login},companyName:row.name,...(packageAuthority?{packageAuthority}:{})}:{authority}),...(claim?{attemptId:claim.attemptId,fence:claim.fence}:{})})+'\n')
    })
  }
  const subscriptionExecute=async(request:Record<string,unknown>,assertOwned?:()=>Promise<void>,cancel?:AbortSignal)=>{
    if(signal.aborted)throw Error('shared_worker_stopping')
    if(cancel?.aborted)throw Error('observe_aborted')
    return new Promise<unknown>((resolve,reject)=>{
      const child=spawn(config.python,['-B','-m','tools.shared_saas_lifecycle.subscription_effect'],{cwd:config.repositoryRoot,stdio:['pipe','pipe','ignore'],env:{...process.env,PYTHONUNBUFFERED:'1'}})
      let buffer='',result:unknown,error:Error|undefined,chain=Promise.resolve()
      const fail=(e:unknown)=>{error=e instanceof Error?e:Error('shared_effect_unverified');child.kill('SIGTERM')}
      const abort=()=>fail(Error('shared_worker_stopping'))
      const cancelled=()=>fail(Error('observe_aborted'))
      signal.addEventListener('abort',abort,{once:true});cancel?.addEventListener('abort',cancelled,{once:true})
      const timer=setTimeout(()=>fail(Error('shared_effect_timeout')),30*60*1000)
      const heartbeat=setInterval(()=>{if(assertOwned)void assertOwned().catch(fail)},15000)
      child.on('error',fail);child.stdin.on('error',fail)
      child.stdout.on('data',chunk=>{
        buffer+=String(chunk)
        if(buffer.length>65536){fail(Error('shared_protocol_invalid'));return}
        let newline:number
        while((newline=buffer.indexOf('\n'))>=0){
          const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1)
          chain=chain.then(async()=>{
            if(error)return
            const message=JSON.parse(line)
            if(message.permit){
              if(!assertOwned || !['modules','apply'].includes(message.permit))throw Error('shared_protocol_invalid')
              await assertOwned()
              if(error || signal.aborted)throw Error('shared_lease_lost')
              child.stdin.write(JSON.stringify({proceed:true})+'\n')
            }else if(message.error_code)throw Error(message.error_code)
            else if(Object.hasOwn(message,'result') && result===undefined)result=message.result
            else throw Error('shared_protocol_invalid')
          }).catch(fail)
        }
      })
      child.on('close',code=>{
        clearTimeout(timer);clearInterval(heartbeat);signal.removeEventListener('abort',abort);cancel?.removeEventListener('abort',cancelled)
        void chain.then(()=>error?reject(error):code!==0 || result===undefined?reject(Error('shared_effect_unverified')):resolve(result))
      })
      child.stdin.write(JSON.stringify({...request,config:runtime})+'\n')
    })
  }
  const subscriptionRunner:SubscriptionRunner=async input=>{
    const assertCurrent=async()=>{await input.assertOwned();await transaction(pool,client=>assertReconfigureAuthority(client,input.job))}
    await assertCurrent()
    return subscriptionExecute({action:input.action,tenant:{database:input.job.binding.database,host:input.job.host},...input.job.authority,attemptId:input.attemptId,fence:input.fence},assertCurrent)
  }
  const observeSubscription:ObserveRunner=async input=>{
    const row=await pool.query('SELECT host FROM shared_registry_bindings WHERE control_tenant_id=$1',[input.tenant_id])
    if(!row.rowCount)throw Error('tenant_binding_mismatch')
    return await subscriptionExecute({action:'observe',tenant:{database:input.database,host:row.rows[0].host},attemptId:randomUUID(),fence:0},undefined,input.signal) as Awaited<ReturnType<ObserveRunner>>
  }
  // The same read-only observe action; the collector validates every field it keeps.
  const observeUsage:NonNullable<SharedFencedAdapter['observeUsage']>=async input=>await observeSubscription(input) as unknown
  return {
    subscriptionRunner,observeSubscription,observeUsage,
    async observe(job){
      try{return sharedObservationSchema.parse(await execute(job,'observe'))}catch{return {state:'unknown'}}
    },
    async applyFenced(input){
      await input.assertOwned()
      const result=await execute(input.job,'apply',input)
      if(!result || typeof result!=='object' || (result as {applied?:unknown}).applied!==true)throw Error('shared_effect_unverified')
      await input.assertOwned()
      if(input.job.operation==='backup')await recordOdooBackup(pool,runtime,input.job,input)
    },
    async setAdminPassword(input){
      // Accepted invitation identity is still checked against the provisioned
      // onboarding and active route; never resolve a caller-supplied database.
      const rows=await pool.query(`SELECT b.database_name,b.host FROM shared_registry_bindings b
        JOIN shared_onboardings o ON o.control_tenant_id=b.control_tenant_id AND o.database_name=b.database_name AND o.host=b.host
        JOIN tenants t ON t.id=b.control_tenant_id
        WHERE b.control_tenant_id=$1 AND b.enabled=true AND o.stage='active' AND o.admin_login=$2
          AND t.commercial_mode='saas' AND t.status='active'`,[input.tenant_id,input.admin_login])
      if(rows.rowCount!==1)throw Error('user_missing')
      if(signal.aborted)throw Error('script_failed')
      return new Promise<unknown>((resolve,reject)=>{
        const child=spawn(config.python,['-B','-m','tools.shared_saas_lifecycle.admin_password_effect'],
          {cwd:config.repositoryRoot,stdio:['pipe','pipe','ignore'],env:{...process.env,PYTHONUNBUFFERED:'1'}})
        const allowed=new Set(['user_missing','user_inactive','password_policy','database_invalid','script_failed'])
        let buffer='',bytes=0,errorCode:string|undefined
        const fail=(code='script_failed')=>{errorCode??=code;child.kill('SIGTERM')}
        const abort=()=>fail()
        signal.addEventListener('abort',abort,{once:true})
        const timer=setTimeout(()=>fail(),200000)
        child.on('error',()=>fail());child.stdin.on('error',()=>fail())
        child.stdout.on('data',chunk=>{
          bytes+=Buffer.byteLength(chunk)
          if(bytes>65536){buffer='';fail();return}
          if(!errorCode)buffer+=String(chunk)
        })
        child.on('close',code=>{
          clearTimeout(timer);signal.removeEventListener('abort',abort)
          try{
            if(errorCode)throw Error(errorCode)
            const message=JSON.parse(buffer)
            buffer=''
            if(message && Object.keys(message).length===1 && typeof message.error_code==='string')
              throw Error(allowed.has(message.error_code)?message.error_code:'script_failed')
            if(code!==0 || !message || Object.keys(message).length!==1 || !Object.hasOwn(message,'result'))throw Error('script_failed')
            resolve(message.result)
          }catch(e){
            buffer=''
            reject(Error(e instanceof Error && allowed.has(e.message)?e.message:'script_failed'))
          }
        })
        // Neither spawn argv/environment nor logs contain the caller password.
        child.stdin.end(JSON.stringify({action:'set_admin_password',tenant:{database:rows.rows[0].database_name,host:rows.rows[0].host},
          login:input.admin_login,password:input.password,config:runtime})+'\n')
        if(signal.aborted)fail()
      })
    },
  }
}

/** Route publication is deliberately AFTER durable physical verification. It
 * has its own resumable stage; job binding revision remains the creation one. */
export async function reconcileOdooOnboardings(pool:Pool,config:Config,adapter:SharedFencedAdapter){
  const candidates=await pool.query(`SELECT o.*,j.payload,j.receipt,j.state FROM shared_onboardings o JOIN shared_jobs j ON j.id=o.job_id
    WHERE j.state='verified' AND o.stage IN ('queued','verifying','activating') ORDER BY o.created_at LIMIT 10`)
  for(const row of candidates.rows){
    const job=row.payload as SharedJob
    const actor=provisioningActor(config,row)
    const observed=sharedObservationSchema.parse(await adapter.observe(job))
    if(observed.state!=='present' || !observed.verified || observed.payloadDigest!==row.job_digest || observed.businessKey!==businessKey(job) || (['tenantId','database','filestore','registryRevision'] as const).some(field=>observed.binding[field]!==job.binding[field])) {
      // Quarantine this candidate once; it cannot occupy every future LIMIT batch.
      // No catch here: unexpected DB/programming errors remain visible to the worker.
      await transaction(pool,async client=>{
        await client.query("UPDATE shared_onboardings SET stage='needs_intervention',error_code='readiness_recheck_failed' WHERE request_id=$1 AND stage IN ('queued','verifying','activating')",[row.request_id])
        await client.query("UPDATE tenants SET status='needs_intervention' WHERE id=$1 AND status<>'active'",[row.control_tenant_id])
      })
      continue
    }
    await transaction(pool,async client=>{
      await requireOnboardingAuthority(client,actor)
      await requireJobAuthority(client,row.control_tenant_id,actor)
      const verified=await client.query("SELECT 1 FROM shared_jobs WHERE id=$1 AND state='verified' AND payload_digest=$2 AND receipt->>'payloadDigest'=$2 FOR SHARE",[row.job_id,row.job_digest])
      if(!verified.rowCount)throw Error('shared_verification_lost')
      await client.query("UPDATE shared_onboardings SET stage='activating',error_code=NULL WHERE request_id=$1 AND stage IN ('queued','verifying','activating')",[row.request_id])
    })
    if(await lstat(`${config.tenantRegistryPath}.pending`).catch(()=>null))await recoverRegistry(pool,config.tenantRegistryPath!,actor,'Resume verified route publication')
    const binding=await pool.query('SELECT enabled,registry_revision::float8 AS revision FROM shared_registry_bindings WHERE control_tenant_id=$1',[row.control_tenant_id])
    if(!binding.rows[0].enabled){
      if(binding.rows[0].revision!==job.binding.registryRevision)throw Error('tenant_binding_mismatch')
      const state=await pool.query('SELECT revision::float8 AS revision FROM shared_registry_state WHERE singleton=true')
      await publishRegistryMutation(pool,config.tenantRegistryPath!,actor,{controlTenantId:row.control_tenant_id,expectedSnapshotRevision:state.rows[0].revision,target:{...job.binding,host:row.host,enabled:true,registryRevision:job.binding.registryRevision+1},reason:'Activate independently verified Odoo tenant'})
    }else if(binding.rows[0].revision!==job.binding.registryRevision+1)throw Error('tenant_binding_mismatch')
    // Lock the current onboarding before deciding: a concurrent reconciler's
    // quarantine must never be overwritten by this candidate's stale readback.
    // External Odoo observation stays outside control-plane transactions.
    await transaction(pool,async client=>{
      const current=await client.query('SELECT stage,job_id,job_digest FROM shared_onboardings WHERE request_id=$1 FOR UPDATE',[row.request_id])
      if(!current.rowCount || current.rows[0].stage!=='activating')return
      if(current.rows[0].job_id!==row.job_id || current.rows[0].job_digest!==row.job_digest)throw Error('shared_activation_state_changed')
      await requireOnboardingAuthority(client,actor)
      await requireJobAuthority(client,row.control_tenant_id,actor)
      const verified=await client.query(`SELECT j.id FROM shared_jobs j JOIN shared_registry_bindings b ON b.control_tenant_id=j.control_tenant_id
        WHERE j.id=$1 AND j.control_tenant_id=$2 AND j.state='verified' AND j.payload_digest=$3
        AND j.receipt->>'payloadDigest'=$3 AND j.receipt->>'status'='verified'
        AND b.enabled=true AND b.tenant_id=$4 AND b.database_name=$5 AND b.filestore=$6 AND b.registry_revision=$7
        FOR SHARE OF j,b`,[row.job_id,row.control_tenant_id,row.job_digest,job.binding.tenantId,job.binding.database,job.binding.filestore,job.binding.registryRevision+1])
      if(!verified.rowCount)throw Error('shared_verification_lost')
      const activated=await client.query("UPDATE shared_onboardings SET stage='active',error_code=NULL WHERE request_id=$1 AND stage='activating' AND job_id=$2 AND job_digest=$3 RETURNING request_id",[row.request_id,row.job_id,row.job_digest])
      if(activated.rowCount!==1)throw Error('shared_activation_state_changed')
      await client.query("UPDATE tenants SET status='active',policy_revision=1,desired_policy=$2,observed_policy=$2,health_checked_at=clock_timestamp() WHERE id=$1",[row.control_tenant_id,job.operation==='provision'?job.policy.features:null])
    })
  }
}
