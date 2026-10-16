import {afterAll,beforeAll,describe,expect,it} from 'vitest'
import {Pool} from 'pg'
import {randomUUID,createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {migrate,transaction} from '../db.js'
import {getPackage,listPackages,resolvePackageAuthority,resolvePackageJobAuthority} from '../packages.js'
import {seedPublishedPackage} from './package-fixtures.js'
import {packageHttp} from '../package-http.js'
import {createSharedOrder} from '../shared/shared-order.js'
import {bindJob,payloadDigest,businessKey} from '../shared/provisioning.js'
import { vendorAccount, replaceRoles } from './helpers/vendor-session.js'
import { vendorActorIssuer } from '../admin-auth/grants.js'
const sourceOptions={repositoryRoot:fileURLToPath(new URL('../../../..',import.meta.url))}
const url=process.env.CONTROL_TEST_DATABASE_URL
if(url){const p=new URL(url);if(!['127.0.0.1','localhost','::1'].includes(p.hostname)||!/^webvue_control_scratch_[a-z0-9]+$/.test(p.pathname.slice(1)))throw Error('scratch control DB required')}
const suite=url?describe:describe.skip
suite('package immutable lifecycle and enrollment authority SQL',()=>{
 const pool=new Pool({connectionString:url,max:5})
 const actor={issuer:vendorActorIssuer(`packages-${randomUUID()}`),actorUid:7}
 const input={name:'Projects limited',description:'A governed project workspace',catalog_version:`packages-${randomUUID()}`,catalog_tier:'projects',limits:{'users.limit':3,'storage.limit_mb':2,'projects.max_projects':1}}
 const reason='Review immutable package policy'
 let published:{id:string;package_id:string;revision:number}
 beforeAll(async()=>{
  await migrate(pool)
  const raw=await readFile(new URL('../../../../deploy/catalog/solutions/platform.json',import.meta.url))
  await pool.query("INSERT INTO catalog_entries(id,version,status,solution,source_sha256) VALUES($1,$2,'published',$3,$4)",[randomUUID(),input.catalog_version,JSON.parse(raw.toString()),createHash('sha256').update(raw).digest('hex')])
  await vendorAccount(pool,['product','customer_success','operations'],7)
  published=await seedPublishedPackage(pool,input)
 })
 afterAll(async()=>pool.end())
 it('freezes published content and refuses deleting it',async()=>{
  await expect(pool.query("UPDATE package_revisions SET name='Changed',revision=revision+1 WHERE id=$1",[published.id])).rejects.toThrow('published_package_immutable')
  await expect(pool.query('DELETE FROM package_revisions WHERE id=$1',[published.id])).rejects.toThrow('package_delete_forbidden')
 })
 it('serializes withdrawal with assignment and preserves pinned replay authority',async()=>{
  const tenant=randomUUID()
  const client=await pool.connect()
  let authority
  try{
   await client.query('BEGIN')
   authority=await resolvePackageAuthority(client,published.id,true,sourceOptions)
   const withdraw=pool.query('UPDATE package_revisions SET available=false,revision=revision+1 WHERE id=$1 RETURNING available',[published.id])
   await client.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,catalog_version,catalog_tier,package_revision_id,operations_enabled) VALUES($1,'Pinned','saas','managed',$2,$3,$4,$5,true)",[tenant,`package-${tenant}`,input.catalog_version,input.catalog_tier,published.id])
   await client.query('COMMIT')
   expect((await withdraw).rows[0].available).toBe(false)
  }finally{await client.query('ROLLBACK');client.release()}
  await expect(transaction(pool,c=>resolvePackageAuthority(c,published.id,true,sourceOptions))).rejects.toThrow('package_unavailable')
  expect(await transaction(pool,c=>resolvePackageAuthority(c,published.id))).toEqual(authority)
  const slug=`t${tenant.replaceAll('-','')}`, database=`webvue_scratch_${tenant.replaceAll('-','')}`
  // A queued job references the durable registry binding, not tenants directly.
  // This policy-only fixture keeps the route disabled and creates no database.
  await pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,false,1)',[tenant,slug,`${slug}.packages.test`,database])
  const job=bindJob({schemaVersion:1,operation:'provision',requestId:randomUUID(),binding:{tenantId:slug,database,filestore:database,registryRevision:1},catalog:authority!.catalog,policy:authority!.policy,packageAuthority:authority})
  await pool.query('INSERT INTO shared_jobs(id,control_tenant_id,business_key,payload,payload_digest,issuer,actor_uid,reason) VALUES($1,$2,$3,$4,$5,$6,7,$7)',[randomUUID(),tenant,businessKey(job),job,payloadDigest(job),actor.issuer,reason])
  expect(await resolvePackageJobAuthority(pool,job)).toEqual(authority)
  if(job.operation!=='provision')throw Error('bad test job')
  await expect(resolvePackageJobAuthority(pool,{...job,packageAuthority:undefined})).rejects.toThrow('package_authority_mismatch')
  await expect(resolvePackageJobAuthority(pool,{...job,policy:{...job.policy,features:{...job.policy.features,'users.limit':99}}})).rejects.toThrow('package_authority_mismatch')
  await expect(pool.query('UPDATE tenants SET package_revision_id=NULL WHERE id=$1',[tenant])).rejects.toThrow('tenant_package_immutable')
  await expect(createSharedOrder(pool,{controlTenantId:tenant,idempotencyKey:randomUUID(),quote:{schemaVersion:1,currency:'SAR',billingCycle:'monthly',priceMinorUnits:1,taxMinorUnits:0,catalogVersion:input.catalog_version,catalogTier:input.catalog_tier}})).rejects.toThrow('package_order_unsupported')
  expect((await getPackage(pool,published.id)).customer_count).toBe(1)
 })
 it.each([{key:'users.limit',code:'package_admin_required'},{key:'storage.limit_mb',code:'package_storage_required'}])('retains zero $key but refuses a new assignment',async({key,code})=>{
  const zero=await seedPublishedPackage(pool,{...input,limits:{...input.limits,[key]:0}})
  expect((await getPackage(pool,zero.id)).limits[key]).toBe(0)
  await expect(transaction(pool,c=>resolvePackageAuthority(c,zero.id,true,sourceOptions))).rejects.toMatchObject({code,status:422,field:`limits.${key}`})
  await transaction(pool,c=>resolvePackageAuthority(c,zero.id))
 })
 it('rejects stale or unavailable repository sources at new assignment',async()=>{
  const unavailable={repositoryRoot:sourceOptions.repositoryRoot+'/missing-package-source'}
  const active=await seedPublishedPackage(pool,input)
  await expect(transaction(pool,c=>resolvePackageAuthority(c,active.id,true,unavailable))).rejects.toMatchObject({code:'package_source_unavailable',status:422})
  const staleVersion=`packages-stale-${randomUUID()}`
  const source=await pool.query('SELECT solution FROM catalog_entries WHERE version=$1',[input.catalog_version])
  await pool.query("INSERT INTO catalog_entries(id,version,status,solution,source_sha256) VALUES($1,$2,'published',$3,$4)",[randomUUID(),staleVersion,source.rows[0].solution,'a'.repeat(64)])
  const stale=await seedPublishedPackage(pool,{...input,catalog_version:staleVersion},{sourceSha256:'a'.repeat(64)})
  await expect(transaction(pool,c=>resolvePackageAuthority(c,stale.id,true,sourceOptions))).rejects.toMatchObject({code:'package_source_mismatch',status:422,field:'catalog_version'})
 })
 it('keeps reads and refuses every HTTP write once Track A is retired',async()=>{
  const request={repositoryRoot:sourceOptions.repositoryRoot,method:'POST',pathname:'/v1/packages',raw:JSON.stringify(input),issuer:actor.issuer,actor:7,stepUpFresh:true,capabilities:['vendor.read'] as ('vendor.read')[]}
  await expect(packageHttp(pool,request)).rejects.toMatchObject({status:403})
  await expect(packageHttp(pool,{...request,capabilities:['vendor.catalog.manage']})).rejects.toMatchObject({status:410,code:'packages_retired'})
  await expect(packageHttp(pool,{...request,capabilities:['vendor.catalog.manage'],pathname:`/v1/packages/${published.id}/restore`,raw:JSON.stringify({revision:published.revision,reason:'Retired'})})).rejects.toMatchObject({status:410})
  const read=await packageHttp(pool,{...request,method:'GET',pathname:`/v1/packages/${published.id}`})
  expect(read?.status).toBe(200)
  const list=await listPackages(pool);expect(list.items.some(p=>p.id===published.id)).toBe(true)
 })
})
