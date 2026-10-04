import { z } from 'zod'
import type { Pool } from 'pg'
import { packageInputSchema,packageEditSchema,packageActionSchema,packageCloneSchema,type VendorCapability } from '@nasq/commercial-contracts'
import { createPackage,getPackage,listPackages,mutatePackage,PackageError } from './packages.js'

/** Returns null only when this route is outside the package resource. */
export async function packageHttp(pool:Pool,input:{method:string;pathname:string;raw:string;issuer:string;actor:number;capabilities:VendorCapability[];repositoryRoot:string}) {
  const match=/^\/v1\/packages(?:\/([0-9a-f-]{36})(?:\/(validate|publish|withdraw|restore|revisions))?)?$/.exec(input.pathname)
  if(!match)return null
  const capability=input.method==='GET'?'vendor.read':'vendor.catalog.manage'
  if(!input.capabilities.includes(capability))throw new PackageError('package_forbidden',403)
  const id=match[1],action=match[2]
  const actor={issuer:input.issuer,actorUid:input.actor}
  const source={repositoryRoot:input.repositoryRoot}
  function parse<T>(schema:z.ZodType<T>):T {
    let value:unknown
    try{value=JSON.parse(input.raw)}catch{throw new PackageError('invalid',422,'body')}
    const result=schema.safeParse(value)
    if(!result.success)throw new PackageError('invalid',422,String(result.error.issues[0]?.path[0]??'body'))
    return result.data
  }
  if(id&&!z.uuid().safeParse(id).success)throw new PackageError('package_missing',404)
  if(input.method==='GET'&&!action)return {status:200,data:id?await getPackage(pool,id):await listPackages(pool)}
  if(input.method==='POST'&&!id)return {status:201,data:await createPackage(pool,actor,parse(packageInputSchema))}
  if(id&&!action&&input.method==='PATCH')return {status:200,data:await mutatePackage(pool,actor,id,'edit',parse(packageEditSchema),source)}
  if(id&&!action&&input.method==='DELETE')return {status:200,data:await mutatePackage(pool,actor,id,'delete',parse(packageActionSchema),source)}
  if(id&&action&&input.method==='POST')return {status:action==='revisions'?201:200,data:await mutatePackage(pool,actor,id,action as 'validate'|'publish'|'withdraw'|'restore'|'revisions',action==='revisions'?parse(packageCloneSchema):parse(packageActionSchema),source)}
  throw new PackageError('not_found',404)
}
