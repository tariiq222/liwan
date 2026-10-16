import { z } from 'zod'
import type { Pool } from 'pg'
import type { VendorCapability } from '@webvue/commercial-contracts'
import { getPackage,listPackages,PackageError } from './packages.js'

/** Returns null only when this route is outside the package resource. */
export async function packageHttp(pool:Pool,input:{method:string;pathname:string;raw:string;actor:number;capabilities:VendorCapability[];stepUpFresh?:boolean;repositoryRoot:string}) {
  const match=/^\/v1\/packages(?:\/([0-9a-f-]{36})(?:\/(validate|publish|withdraw|restore|revisions))?)?$/.exec(input.pathname)
  if(!match)return null
  const capability=input.method==='GET'?'vendor.read':'vendor.catalog.manage'
  if(!input.capabilities.includes(capability))throw new PackageError('package_forbidden',403)
  if(input.method!=='GET'&&match[2]==='publish'&&!input.stepUpFresh)throw new PackageError('step_up_required',403)
  const id=match[1],action=match[2]
  if(id&&!z.uuid().safeParse(id).success)throw new PackageError('package_missing',404)
  if(input.method==='GET'&&!action)return {status:200,data:id?await getPackage(pool,id):await listPackages(pool)}
  // Owner decision O1 (2026-10-07): plans are sold; Track A packages are read-only history.
  if(input.method!=='GET')throw new PackageError('packages_retired',410,undefined,'Packages are retired; sell a plan instead')
  throw new PackageError('not_found',404)
}
