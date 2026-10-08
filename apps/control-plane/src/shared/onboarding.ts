import { isCommercialEnrollmentActor, requireCommercialEnrollmentAuthority } from './commercial-enrollment-authority.js'
import { PackageError } from '../packages.js'
import { createHash, randomUUID } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import type { Pool, PoolClient } from 'pg'
import { sharedOnboardingRequestSchema } from '@nasq/commercial-contracts'
import type { SharedJob } from '@nasq/commercial-contracts/shared'
import type { Config } from '../config.js'
import { transaction } from '../db.js'
import { loadSharedRuntimeConfig } from './runtime-config.js'
import { publishRegistryMutation, recoverRegistry, resolveRegistryBinding, type RegistryActor } from './registry-store.js'
import { deriveSharedPolicy, enqueueSharedJob } from './job-store.js'
import { payloadDigest } from './provisioning.js'

export function onboardingIdentity(value:unknown,domainSuffix:string){
  const input=sharedOnboardingRequestSchema.parse(value)
  const hex=input.request_id.replaceAll('-','')
  return {tenantId:input.request_id,slug:`t${hex}`,database:`nasq_scratch_${hex}`,host:`t${hex}.${domainSuffix}`,digest:createHash('sha256').update(JSON.stringify(input)).digest('hex')}
}
export function assertOnboardingReplay(row:{issuer:string;actor_uid:number|string;request_digest:string},actor:RegistryActor,digest:string){
  if(row.issuer!==actor.issuer || Number(row.actor_uid)!==actor.actorUid)throw Error('shared_replay_forbidden')
  if(row.request_digest!==digest)throw Error('idempotency_conflict')
}
export async function requireOnboardingAuthority(client:PoolClient,actor:RegistryActor){
  if(isCommercialEnrollmentActor(actor)){await requireCommercialEnrollmentAuthority(client,actor);return}
  const grant=await client.query("SELECT 1 FROM vendor_memberships WHERE issuer=$1 AND actor_uid=$2 AND revoked_at IS NULL AND capabilities @> ARRAY['vendor.tenants.manage','vendor.operations.run']::text[] FOR SHARE",[actor.issuer,actor.actorUid])
  if(!grant.rowCount)throw Error('shared_onboarding_forbidden')
}
export async function sharedOnboardingEnabled(config:Config){
  if(!config.sharedRuntimeConfigPath || !config.tenantRegistryPath || process.env.NASQ_TENANCY_MODE!=='shared')return false
  try{loadSharedRuntimeConfig(config.sharedRuntimeConfigPath);return true}catch{return false}
}
/** Only exact durable first-create identity can treat a disabled route as a worker target. */
export async function resolveProvisionTarget(client:PoolClient,controlTenantId:string,job:SharedJob){
  const target=await resolveRegistryBinding(client,controlTenantId)
  if(target.enabled)return target
  if(job.operation!=='provision')return target
  const row=await client.query(`SELECT 1 FROM shared_onboardings WHERE control_tenant_id=$1 AND request_id=$2 AND job_digest=$3
    AND tenant_slug=$4 AND database_name=$5 AND stage IN ('queued','verifying','needs_intervention') FOR SHARE`,[controlTenantId,job.requestId,payloadDigest(job),target.tenantId,target.database])
  return row.rowCount?{...target,enabled:true}:target
}
export async function onboardSharedTenant(pool:Pool,config:Config,actor:RegistryActor,value:unknown){
  const input=sharedOnboardingRequestSchema.parse(value)
  if(!await sharedOnboardingEnabled(config))throw Error('shared_adapter_unavailable')
  const runtime=loadSharedRuntimeConfig(config.sharedRuntimeConfigPath!)
  const identity=onboardingIdentity(input,runtime.domainSuffix)
  const replay=await transaction(pool,async client=>{
    await requireOnboardingAuthority(client,actor)
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[input.request_id])
    const existing=await client.query('SELECT * FROM shared_onboardings WHERE request_id=$1 FOR UPDATE',[input.request_id])
    if(existing.rowCount){assertOnboardingReplay(existing.rows[0],actor,identity.digest);return true}
    // Owner decision O1: no new Track A assignment; existing pinned tenants keep theirs.
    if(input.package_revision_id)throw new PackageError('package_retired',410,'package_revision_id','Packages are retired; subscribe the customer to a plan')
    const version=input.catalog_version!, tier=input.catalog_tier!
    const catalog=await client.query("SELECT solution FROM catalog_entries WHERE version=$1 AND status='published' FOR SHARE",[version])
    if(!catalog.rowCount)throw Error('published_catalog_missing')
    deriveSharedPolicy(catalog.rows[0].solution,tier)
    await client.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,catalog_version,catalog_tier,package_revision_id,operations_enabled,status) VALUES($1,$2,'saas','managed',$3,$4,$5,NULL,true,'provisioning')",[identity.tenantId,input.name,`shared-${identity.slug}`,version,tier])
    await client.query('INSERT INTO shared_onboardings(request_id,control_tenant_id,issuer,actor_uid,request_digest,admin_name,admin_login,host,tenant_slug,database_name) VALUES($1,$1,$2,$3,$4,$5,$6,$7,$8,$9)',[input.request_id,actor.issuer,actor.actorUid,identity.digest,input.admin_name,input.admin_login,identity.host,identity.slug,identity.database])
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason) VALUES($1,$2,$3,$4,$5)',[randomUUID(),`${actor.issuer}:${actor.actorUid}`,'shared_onboarding.reserved',identity.tenantId,input.reason])
    return false
  })
  try{
    // Resume publication after a committed SQL snapshot; never repeat a physical effect.
    const pending=await lstat(`${config.tenantRegistryPath}.pending`).catch(()=>null)
    if(pending)await recoverRegistry(pool,config.tenantRegistryPath!,actor,'Resume shared onboarding publication')
    const binding=await pool.query('SELECT 1 FROM shared_registry_bindings WHERE control_tenant_id=$1',[identity.tenantId])
    if(!binding.rowCount){
      const state=await pool.query('SELECT revision::float8 AS revision FROM shared_registry_state WHERE singleton=true')
      await publishRegistryMutation(pool,config.tenantRegistryPath!,actor,{controlTenantId:identity.tenantId,expectedSnapshotRevision:state.rows[0].revision,target:{host:identity.host,tenantId:identity.slug,database:identity.database,filestore:identity.database,enabled:false,registryRevision:1},reason:input.reason})
    }
    const existingJob=await pool.query('SELECT job_id FROM shared_onboardings WHERE request_id=$1',[input.request_id])
    if(!existingJob.rows[0].job_id)await enqueueSharedJob(pool,identity.tenantId,actor,{schemaVersion:1,operation:'provision',requestId:input.request_id},input.reason)
    const progress=await sharedProvisioningProgress(pool,identity.tenantId)
    return {tenant_id:progress.tenant_id,job_id:progress.job_id,status:progress.status,host:progress.host,replay}
  }catch{
    await pool.query("UPDATE shared_onboardings SET error_code='onboarding_pending' WHERE request_id=$1 AND stage<>'active'",[input.request_id])
    const progress=await sharedProvisioningProgress(pool,identity.tenantId)
    return {tenant_id:progress.tenant_id,job_id:progress.job_id,status:progress.status,host:progress.host,replay}
  }
}
export async function sharedProvisioningProgress(pool:Pool,id:string){
  const result=await pool.query(`SELECT o.control_tenant_id AS tenant_id,o.job_id,CASE WHEN j.state='needs_intervention' THEN 'needs_intervention' ELSE t.status END AS status,o.host,o.admin_login,
    CASE WHEN j.state='needs_intervention' THEN 'needs_intervention' ELSE o.stage END AS stage,
    CASE WHEN j.state='needs_intervention' THEN 'provision_needs_intervention' ELSE o.error_code END AS error_code
    FROM shared_onboardings o JOIN tenants t ON t.id=o.control_tenant_id LEFT JOIN shared_jobs j ON j.id=o.job_id WHERE o.control_tenant_id=$1`,[id])
  if(!result.rowCount)throw Error('shared_onboarding_missing')
  return result.rows[0] as {tenant_id:string;job_id:string|null;status:string;host:string;admin_login:string;stage:string;error_code:string|null}
}
