import { describe,it,expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import * as packages from '../packages.js'
import { derivePackagePolicy,packageContentDigest,assertPackageJobAuthority } from '../packages.js'
import { deriveSharedPolicy } from '../shared/job-store.js'
const catalog=JSON.parse(readFileSync(new URL('../../../../deploy/catalog/solutions/platform.json',import.meta.url),'utf8'))
const limits={'users.limit':3,'storage.limit_mb':2,'projects.max_projects':1}
describe('trusted commercial packages',()=>{
 it('refuses a schema-1 catalog carrying a numeric ceiling through the shared parser',()=>{const bad={schema_version:1,base_modules:['webvue_core'],tiers:[{id:'core',modules:[],features:['limit:branches.extra_limit:0']}]};expect(()=>derivePackagePolicy(bad,'core',{'users.limit':3,'storage.limit_mb':2})).toThrow(expect.objectContaining({code:'catalog_invalid'}))})
 it('derives finite policy from one trusted composition',()=>{expect(derivePackagePolicy(catalog,'projects',limits).features).toEqual({...limits,'pmo.enabled':true,'meetings.enabled':true})})
 it('preserves zero versus unlimited and historical unlimited',()=>{expect(derivePackagePolicy(catalog,'core',{'users.limit':0,'storage.limit_mb':null}).features).toEqual({'users.limit':0,'storage.limit_mb':null});expect(deriveSharedPolicy(catalog,'projects').features['users.limit']).toBeNull()})
 it('rejects arbitrary, missing, boolean, fractional and unsafe quotas',()=>{for(const value of [-1,0.1,true,Number.MAX_SAFE_INTEGER+1])expect(()=>derivePackagePolicy(catalog,'projects',{...limits,'users.limit':value})).toThrow();for(const value of [{...limits,'pmo.enabled':1},{'users.limit':1},{...limits,'evil.limit':1}])expect(()=>derivePackagePolicy(catalog,'projects',value)).toThrow()})
 it('binds digest to content with canonical limit ordering',()=>{const a={name:'A',limits:{b:0,a:null}};expect(packageContentDigest(a)).toBe(packageContentDigest({limits:{a:null,b:0},name:'A'}));expect(packageContentDigest(a)).not.toBe(packageContentDigest({...a,name:'B'}))})
 it('rejects job authority mismatch',()=>{const authority={schemaVersion:2,revisionId:'a',digest:'b',catalog:{version:'v1',tier:'core',sourceSha256:'c'},policy:derivePackagePolicy(catalog,'core',{'users.limit':0,'storage.limit_mb':null})};expect(()=>assertPackageJobAuthority({...authority},authority)).not.toThrow();expect(()=>assertPackageJobAuthority({...authority,digest:'forged'},authority)).toThrow()})
})

describe('package activation prerequisites',()=>{
 it('keeps zero in draft policy but refuses activation without its required administrator',()=>{
  const zero=derivePackagePolicy(catalog,'core',{'users.limit':0,'storage.limit_mb':0})
  expect(zero.features['users.limit']).toBe(0)
  expect(()=>packages.assertPackageProvisionable(zero)).toThrowError(expect.objectContaining({code:'package_admin_required',status:422,field:'limits.users.limit'}))
  for(const value of [1,null])expect(()=>packages.assertPackageProvisionable(derivePackagePolicy(catalog,'core',{'users.limit':value,'storage.limit_mb':1}))).not.toThrow()
 })
 it('refuses zero storage because bootstrap attachments consume the same quota',()=>{
  const zero=derivePackagePolicy(catalog,'core',{'users.limit':1,'storage.limit_mb':0})
  expect(zero.features['storage.limit_mb']).toBe(0)
  expect(()=>packages.assertPackageProvisionable(zero)).toThrowError(expect.objectContaining({code:'package_storage_required',status:422,field:'limits.storage.limit_mb'}))
  expect(()=>packages.assertPackageProvisionable(derivePackagePolicy(catalog,'core',{'users.limit':1,'storage.limit_mb':null}))).not.toThrow()
 })
 it('requires actual repository catalog bytes to match the pinned source',async()=>{
  const root=fileURLToPath(new URL('../../../..',import.meta.url))
  const raw=readFileSync(new URL('../../../../deploy/catalog/solutions/platform.json',import.meta.url))
  const hash=createHash('sha256').update(raw).digest('hex')
  await expect(packages.verifyPackageSource({repositoryRoot:root},hash)).resolves.toBeUndefined()
  await expect(packages.verifyPackageSource({repositoryRoot:root},'a'.repeat(64))).rejects.toMatchObject({code:'package_source_mismatch',status:422,field:'catalog_version'})
  await expect(packages.verifyPackageSource({repositoryRoot:root+'/missing-package-source'},hash)).rejects.toMatchObject({code:'package_source_unavailable',status:422})
  await expect(packages.verifyPackageSource(undefined,hash)).rejects.toMatchObject({code:'package_source_unavailable',status:422})
 })
})
