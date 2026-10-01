import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest'
import {Pool} from 'pg'
import {randomUUID,createHash} from 'node:crypto'
import {mkdtemp,realpath,writeFile,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {migrate} from '../db.js'
import {onboardSharedTenant,sharedProvisioningProgress} from '../shared/onboarding.js'
import {publishRegistryMutation} from '../shared/registry-store.js'
const url=process.env.CONTROL_TEST_DATABASE_URL
if(url){const parsed=new URL(url);if(!['127.0.0.1','localhost','::1'].includes(parsed.hostname)||!/^nasq_control_scratch_[a-z0-9]+$/.test(parsed.pathname.slice(1)))throw Error('scratch control DB required')}
const suite=url?describe:describe.skip
suite('real shared onboarding SQL identity and fail-closed publication',()=>{
  const pool=new Pool({connectionString:url})
  const actor={issuer:`onboarding-${randomUUID()}`,actorUid:7}
  const input={request_id:randomUUID(),name:'First tenant',catalog_version:`onboarding-${randomUUID()}`,catalog_tier:'projects',admin_name:'First administrator',admin_login:'first@example.test',reason:'First scratch tenant'}
  let config:any
  beforeAll(async()=>{
    vi.stubEnv('NASQ_TENANCY_MODE','shared')
    await migrate(pool)
    const root=await realpath(await mkdtemp(join(tmpdir(),'nasq-onboarding-')))
    const runtime={schemaVersion:1,projectName:'nasq-saas-onboarding',composeFile:join(root,'compose.yml'),envFile:join(root,'runtime.env'),stateDir:root,domainSuffix:'onboarding.test'}
    await writeFile(runtime.composeFile,'services: {}\n');await writeFile(runtime.envFile,'')
    await writeFile(join(root,'runtime.json'),JSON.stringify(runtime))
    config={installationId:actor.issuer,key:'test-key'.repeat(8),inventoryPath:'/unused',stateDir:root,repositoryRoot:fileURLToPath(new URL('../../../..',import.meta.url)),python:'python3',sharedRuntimeConfigPath:join(root,'runtime.json'),tenantRegistryPath:join(root,'registry.json')}
    const source=await readFile(join(config.repositoryRoot,'deploy/catalog/solutions/platform.json'))
    await pool.query("INSERT INTO catalog_entries(id,version,status,solution,source_sha256) VALUES($1,$2,'published',$3,$4)",[randomUUID(),input.catalog_version,JSON.parse(source.toString()),createHash('sha256').update(source).digest('hex')])
    await pool.query("INSERT INTO vendor_memberships(issuer,actor_uid,capabilities) VALUES($1,7,ARRAY['vendor.read','vendor.tenants.manage','vendor.operations.run']),($1,8,ARRAY['vendor.read','vendor.tenants.manage','vendor.operations.run'])",[actor.issuer])
  })
  afterAll(async()=>{vi.unstubAllEnvs();await pool.end()})
  it('identical replay has one tenant, one job and server-derived catalog policy',async()=>{
    const first=await onboardSharedTenant(pool,config,actor,input)
    const replayed=await onboardSharedTenant(pool,config,actor,input)
    expect(replayed.tenant_id).toBe(first.tenant_id);expect(replayed.job_id).toBe(first.job_id);expect(replayed.replay).toBe(true)
    const jobs=await pool.query('SELECT payload FROM shared_jobs WHERE control_tenant_id=$1',[first.tenant_id])
    expect(jobs.rowCount).toBe(1);expect(jobs.rows[0].payload.policy.modules).toEqual(['nasq_core','nasq_platform','nasq_api','nasq_pmo'])
    expect(jobs.rows[0].payload.policy.features['pmo.enabled']).toBe(true)
    const registry=JSON.parse(await readFile(config.tenantRegistryPath,'utf8'))
    expect(registry.targets.find((target:any)=>target.database===jobs.rows[0].payload.binding.database).enabled).toBe(false)
  })
  it('rejects changed administrator and a different actor replay',async()=>{
    await expect(onboardSharedTenant(pool,config,actor,{...input,admin_login:'other@example.test'})).rejects.toThrow('idempotency_conflict')
    await expect(onboardSharedTenant(pool,config,{...actor,actorUid:8},input)).rejects.toThrow('shared_replay_forbidden')
  })
  it('refuses unavailable adapter and does not reserve another tenant',async()=>{
    await expect(onboardSharedTenant(pool,{...config,sharedRuntimeConfigPath:undefined},actor,{...input,request_id:randomUUID()})).rejects.toThrow('shared_adapter_unavailable')
  })
  it('keeps unready routing disabled even through the generic registry API',async()=>{
    const state=await pool.query('SELECT revision::float8 AS revision FROM shared_registry_state WHERE singleton=true')
    const row=(await pool.query('SELECT * FROM shared_registry_bindings WHERE control_tenant_id=$1',[input.request_id])).rows[0]
    await expect(publishRegistryMutation(pool,config.tenantRegistryPath,actor,{controlTenantId:input.request_id,expectedSnapshotRevision:state.rows[0].revision,target:{tenantId:row.tenant_id,host:row.host,database:row.database_name,filestore:row.filestore,enabled:true,registryRevision:2},reason:'Attempt early activation'})).rejects.toThrow('shared_onboarding_readiness_required')
    const progress=await sharedProvisioningProgress(pool,input.request_id)
    expect(progress.stage).toBe('queued');expect(progress.status).toBe('provisioning')
    expect(Object.keys(progress).sort()).toEqual(['tenant_id','job_id','status','host','admin_login','stage','error_code'].sort())
  })
})
