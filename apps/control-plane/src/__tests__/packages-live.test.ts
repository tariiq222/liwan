import {afterAll,beforeAll,describe,expect,it} from 'vitest'
import {Pool} from 'pg'
import {randomUUID,createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {migrate,transaction} from '../db.js'
import {createPackage,getPackage,listPackages,mutatePackage as mutatePackageStore,resolvePackageAuthority,resolvePackageJobAuthority} from '../packages.js'
import {packageHttp} from '../package-http.js'
import {createSharedOrder} from '../shared/shared-order.js'
import {bindJob,payloadDigest,businessKey} from '../shared/provisioning.js'
import type {PackageRevision} from '@nasq/commercial-contracts'
const sourceOptions={repositoryRoot:fileURLToPath(new URL('../../../..',import.meta.url))}
const mutatePackage:typeof mutatePackageStore=(pool,actor,id,action,input,options=sourceOptions)=>mutatePackageStore(pool,actor,id,action,input,options)
const url=process.env.CONTROL_TEST_DATABASE_URL
if(url){const p=new URL(url);if(!['127.0.0.1','localhost','::1'].includes(p.hostname)||!/^nasq_control_scratch_[a-z0-9]+$/.test(p.pathname.slice(1)))throw Error('scratch control DB required')}
const suite=url?describe:describe.skip
suite('package immutable lifecycle and enrollment authority SQL',()=>{
 const pool=new Pool({connectionString:url,max:5})
 const actor={issuer:`packages-${randomUUID()}`,actorUid:7}
 const input={name:'Projects limited',description:'A governed project workspace',catalog_version:`packages-${randomUUID()}`,catalog_tier:'projects',limits:{'users.limit':3,'storage.limit_mb':2,'projects.max_projects':1}}
 const reason='Review immutable package policy'
 let published:PackageRevision
 beforeAll(async()=>{
  await migrate(pool)
  const raw=await readFile(new URL('../../../../deploy/catalog/solutions/platform.json',import.meta.url))
  await pool.query("INSERT INTO catalog_entries(id,version,status,solution,source_sha256) VALUES($1,$2,'published',$3,$4)",[randomUUID(),input.catalog_version,JSON.parse(raw.toString()),createHash('sha256').update(raw).digest('hex')])
  await pool.query("INSERT INTO vendor_memberships(issuer,actor_uid,capabilities) VALUES($1,7,ARRAY['vendor.read','vendor.catalog.manage','vendor.tenants.manage','vendor.operations.run'])",[actor.issuer])
 })
 afterAll(async()=>pool.end())
 it('validates, invalidates on edit, detects stale publication, freezes published content',async()=>{
  const draft=await createPackage(pool,actor,input)
  expect(draft.status).toBe('draft')
  await expect(mutatePackage(pool,actor,draft.id,'publish',{revision:1,reason})).rejects.toThrow('package_transition_invalid')
  const reviewed=await mutatePackage(pool,actor,draft.id,'validate',{revision:1,reason}) as PackageRevision
  const edited=await mutatePackage(pool,actor,draft.id,'edit',{...input,name:'Edited',revision:reviewed.revision}) as PackageRevision
  expect(edited.status).toBe('draft')
  await expect(mutatePackage(pool,actor,draft.id,'publish',{revision:reviewed.revision,reason})).rejects.toThrow('package_revision_conflict')
  const rechecked=await mutatePackage(pool,actor,draft.id,'validate',{revision:edited.revision,reason}) as PackageRevision
  published=await mutatePackage(pool,actor,draft.id,'publish',{revision:rechecked.revision,reason}) as PackageRevision
  expect(published.available).toBe(true)
  await expect(mutatePackage(pool,actor,draft.id,'edit',{...input,revision:published.revision})).rejects.toThrow('package_transition_invalid')
  await expect(pool.query("UPDATE package_revisions SET name='Changed',revision=revision+1 WHERE id=$1",[published.id])).rejects.toThrow('published_package_immutable')
  await expect(pool.query('DELETE FROM package_revisions WHERE id=$1',[published.id])).rejects.toThrow('package_delete_forbidden')
 })
 it('allows only one concurrent transition from the same review',async()=>{
  const draft=await createPackage(pool,actor,input)
  const results=await Promise.allSettled([mutatePackage(pool,actor,draft.id,'validate',{revision:1,reason}),mutatePackage(pool,actor,draft.id,'edit',{...input,name:'Concurrent',revision:1})])
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1)
  expect(results.filter(r=>r.status==='rejected')).toHaveLength(1)
 })
 it('clones a new revision, deletes only drafts, and audits both actions',async()=>{
  const clone=await mutatePackage(pool,actor,published.id,'revisions',{reason}) as PackageRevision
  expect(clone.package_id).toBe(published.package_id);expect(clone.version).toBe(2);expect(clone.status).toBe('draft')
  expect(await mutatePackage(pool,actor,clone.id,'delete',{revision:1,reason})).toEqual({deleted:true})
  await expect(getPackage(pool,clone.id)).rejects.toThrow('package_missing')
  const audit=await pool.query("SELECT action FROM audit_events WHERE subject=$1 ORDER BY created_at",[clone.id])
  expect(audit.rows.map(r=>r.action)).toEqual(['package.created','package.delete'])
  const draft=await createPackage(pool,actor,input)
  await mutatePackage(pool,actor,draft.id,'validate',{revision:1,reason})
  await expect(mutatePackage(pool,actor,draft.id,'delete',{revision:2,reason})).rejects.toThrow('package_transition_invalid')
 })
 it('serializes withdrawal with assignment and preserves pinned replay authority',async()=>{
  const tenant=randomUUID()
  const client=await pool.connect()
  let authority
  try{
   await client.query('BEGIN')
   authority=await resolvePackageAuthority(client,published.id,true,sourceOptions)
   const withdraw=mutatePackage(pool,actor,published.id,'withdraw',{revision:published.revision,reason})
   await client.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,catalog_version,catalog_tier,package_revision_id,operations_enabled) VALUES($1,'Pinned','saas','managed',$2,$3,$4,$5,true)",[tenant,`package-${tenant}`,input.catalog_version,input.catalog_tier,published.id])
   await client.query('COMMIT')
   const withdrawn=await withdraw as PackageRevision
   expect(withdrawn.available).toBe(false)
  }finally{await client.query('ROLLBACK');client.release()}
  await expect(transaction(pool,c=>resolvePackageAuthority(c,published.id,true,sourceOptions))).rejects.toThrow('package_unavailable')
  expect(await transaction(pool,c=>resolvePackageAuthority(c,published.id))).toEqual(authority)
  const slug=`t${tenant.replaceAll('-','')}`, database=`nasq_scratch_${tenant.replaceAll('-','')}`
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
 it.each([{key:'users.limit',code:'package_admin_required'},{key:'storage.limit_mb',code:'package_storage_required'}])('retains zero $key drafts but rejects review, publication, restoration and new assignment',async({key,code})=>{
  const draft=await createPackage(pool,actor,{...input,limits:{...input.limits,[key]:0}})
  expect(draft.limits[key]).toBe(0)
  const expected={code,status:422,field:`limits.${key}`}
  await expect(mutatePackage(pool,actor,draft.id,'validate',{revision:1,reason})).rejects.toMatchObject(expected)
  expect((await getPackage(pool,draft.id)).status).toBe('draft')
  // Represent a pre-existing reviewed record to exercise the publish defense.
  await pool.query("UPDATE package_revisions SET status='validated',validated_digest=content_digest,revision=revision+1 WHERE id=$1",[draft.id])
  await expect(mutatePackage(pool,actor,draft.id,'publish',{revision:2,reason})).rejects.toMatchObject(expected)
  await pool.query("UPDATE package_revisions SET status='published',published_at=now(),available=false,revision=revision+1 WHERE id=$1",[draft.id])
  await expect(mutatePackage(pool,actor,draft.id,'restore',{revision:3,reason})).rejects.toMatchObject(expected)
  await pool.query('UPDATE package_revisions SET available=true,revision=revision+1 WHERE id=$1',[draft.id])
  await expect(transaction(pool,c=>resolvePackageAuthority(c,draft.id,true,sourceOptions))).rejects.toMatchObject(expected)
 })
 it('rejects stale or unavailable repository sources at review, publication, restoration and new assignment',async()=>{
  const unavailable={repositoryRoot:sourceOptions.repositoryRoot+'/missing-package-source'}
  const draft=await createPackage(pool,actor,input)
  await expect(mutatePackage(pool,actor,draft.id,'validate',{revision:1,reason},unavailable)).rejects.toMatchObject({code:'package_source_unavailable',status:422,field:'catalog_version'})
  await mutatePackage(pool,actor,draft.id,'validate',{revision:1,reason})
  await expect(mutatePackage(pool,actor,draft.id,'publish',{revision:2,reason},unavailable)).rejects.toMatchObject({code:'package_source_unavailable',status:422})
  const active=await mutatePackage(pool,actor,draft.id,'publish',{revision:2,reason}) as PackageRevision
  await expect(transaction(pool,c=>resolvePackageAuthority(c,active.id,true,unavailable))).rejects.toMatchObject({code:'package_source_unavailable',status:422})
  await mutatePackage(pool,actor,active.id,'withdraw',{revision:active.revision,reason})
  await expect(mutatePackage(pool,actor,active.id,'restore',{revision:active.revision+1,reason},unavailable)).rejects.toMatchObject({code:'package_source_unavailable',status:422})
  const source=await pool.query('SELECT solution FROM catalog_entries WHERE version=$1',[input.catalog_version])
  const staleVersion=`packages-stale-${randomUUID()}`
  await pool.query("INSERT INTO catalog_entries(id,version,status,solution,source_sha256) VALUES($1,$2,'published',$3,$4)",[randomUUID(),staleVersion,source.rows[0].solution,'a'.repeat(64)])
  const stale=await createPackage(pool,actor,{...input,catalog_version:staleVersion})
  await expect(mutatePackage(pool,actor,stale.id,'validate',{revision:1,reason})).rejects.toMatchObject({code:'package_source_mismatch',status:422,field:'catalog_version'})
 })
 it('enforces API capability, reason and field errors before mutation',async()=>{
  const request={repositoryRoot:sourceOptions.repositoryRoot,method:'POST',pathname:'/v1/packages',raw:JSON.stringify(input),issuer:actor.issuer,actor:7,capabilities:['vendor.read'] as ('vendor.read')[]}
  await expect(packageHttp(pool,request)).rejects.toMatchObject({status:403})
  await expect(packageHttp(pool,{...request,capabilities:['vendor.catalog.manage'],raw:JSON.stringify({...input,limits:{'evil.enabled':1}})})).rejects.toMatchObject({status:422,field:'limits'})
  await expect(packageHttp(pool,{...request,capabilities:['vendor.catalog.manage'],pathname:`/v1/packages/${published.id}/restore`,raw:JSON.stringify({revision:published.revision+1,reason:'x'})})).rejects.toMatchObject({status:422,field:'reason'})
  const list=await listPackages(pool);expect(list.items.some(p=>p.id===published.id)).toBe(true)
 })
})
