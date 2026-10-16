import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { Pool, PoolClient } from 'pg'
import { z } from 'zod'
import { admitsRequiredAdmin, CatalogInvalidError, packageLimitsSchema, packageRevisionSchema, type PackageRevision } from '@webvue/commercial-contracts'
import { sharedPolicySchema, packageAuthoritySchema, type SharedJob } from '@webvue/commercial-contracts/shared'
import { transaction } from './db.js'
import { resolveCatalogSource, KNOWN_SOURCES, SOLUTIONS_DIR } from './shared/catalog-source.js'
import { derivePolicy } from './shared/catalog-features.js'

export class PackageError extends Error {
  constructor(public code: string, public status = 409, public field?: string, public detail?: string) { super(code) }
}
export type PackageSourceOptions = { repositoryRoot: string }
/** Quotas count the retained active base.user_admin, not additional users. */
export function assertPackageProvisionable(policy: { features: Record<string,boolean|number|null> }) {
  if(!admitsRequiredAdmin(policy.features['users.limit']))throw new PackageError('package_admin_required',422,'limits.users.limit','A package must allow at least one user for its required administrator')
  // The source installs binary bootstrap attachments (including company logo).
  // A positive value is necessary, not proof it fits every source/runtime.
  const storage=policy.features['storage.limit_mb']
  if(storage!==null && (typeof storage!=='number'||storage<1))throw new PackageError('package_storage_required',422,'limits.storage.limit_mb','A package needs positive attachment storage for its bootstrap attachments')
}
/** Same original-byte check used by catalog publication and real provisioning.
 * The repository path is supplied by server config, never by an HTTP request. */
export async function verifyPackageSource(options:PackageSourceOptions|undefined,expectedSha256:string) {
  if(!options?.repositoryRoot || !isAbsolute(options.repositoryRoot))throw new PackageError('package_source_unavailable',422,'catalog_version','The trusted runtime catalog source is unavailable')
  try{await resolveCatalogSource(options.repositoryRoot,expectedSha256)}
  catch(error){
    if(error instanceof Error && error.message==='catalog_source_ambiguous')throw new PackageError('package_source_mismatch',422,'catalog_version','The selected catalog does not match the trusted runtime source')
    // Distinguish an unreadable runtime from a source that simply does not match.
    const known=await Promise.all(KNOWN_SOURCES.map(name=>readFile(join(options.repositoryRoot,SOLUTIONS_DIR,name)).then(()=>true,()=>false)))
    if(!known.some(Boolean))throw new PackageError('package_source_unavailable',422,'catalog_version','The trusted runtime catalog source is unavailable')
    throw new PackageError('package_source_mismatch',422,'catalog_version','The selected catalog does not match the trusted runtime source')
  }
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,canonical(v)]))
  return value
}
export function packageContentDigest(value: unknown) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex') }
export function derivePackagePolicy(value: unknown, tierId: string, input: unknown) {
  const catalog = z.object({base_modules:z.array(z.string()),tiers:z.array(z.object({id:z.string(),modules:z.array(z.string())}).passthrough())}).passthrough().parse(value)
  const tier = catalog.tiers.find(t=>t.id===tierId)
  if (!tier) throw new PackageError('catalog_tier_missing',422,'catalog_tier')
  const limits = packageLimitsSchema.parse(input)
  // The one shared parser owns the grammar and every catalog invariant.
  let derived
  try { derived = derivePolicy(value, tier.id) } catch (error) {
    if (error instanceof CatalogInvalidError) throw new PackageError('catalog_invalid',422)
    throw error
  }
  const features: Record<string,boolean|number|null> = derived.features
  // A catalog-declared numeric ceiling is not operator-overridable.
  const fixed = new Set(derived.parsed.filter(p=>p.kind==='limit' && p.value!==null).map(p=>p.key))
  const allowed = Object.keys(features).filter(k=>features[k]===null && !fixed.has(k)).sort()
  if (JSON.stringify(allowed)!==JSON.stringify(Object.keys(limits).sort())) throw new PackageError('package_limits_invalid',422,'limits')
  Object.assign(features, limits)
  return sharedPolicySchema.parse({schema_version:1,channel:'control_plane',modules:derived.modules,features})
}
export function assertPackageJobAuthority(actual: unknown, trusted: unknown) {
  if (actual===undefined || trusted===undefined || packageContentDigest(actual)!==packageContentDigest(trusted)) throw new PackageError('package_authority_mismatch')
}
type Row = PackageRevision & {content_digest:string;validated_digest:string|null}
const fields = 'r.*, (SELECT count(*)::int FROM tenants t WHERE t.package_revision_id=r.id) AS customer_count'
function wire(row: Record<string,unknown>): PackageRevision {
  return packageRevisionSchema.parse(Object.fromEntries(Object.keys(packageRevisionSchema.shape).map(k=>[k,row[k] instanceof Date ? (row[k] as Date).toISOString():row[k]])))
}
function content(row: Pick<Row,'id'|'package_id'|'version'|'name'|'description'|'catalog_version'|'catalog_tier'|'source_sha256'|'limits'|'modules'|'features'>) {
  const {id,package_id,version,name,description,catalog_version,catalog_tier,source_sha256,limits,modules,features}=row
  return {id,package_id,version,name,description,catalog_version,catalog_tier,source_sha256,limits,modules,features}
}
export async function listPackages(pool:Pool) {
  const result=await pool.query(`SELECT ${fields} FROM package_revisions r ORDER BY r.created_at DESC,r.id`)
  return {items:result.rows.map(wire),total:result.rowCount??0}
}
export async function getPackage(pool:Pool,id:string) {
  const result=await pool.query(`SELECT ${fields} FROM package_revisions r WHERE r.id=$1`,[id])
  if(!result.rowCount)throw new PackageError('package_missing',404)
  return wire(result.rows[0])
}
/** Holds SHARE against withdraw while the enrollment assignment commits. Existing
 * assignments ignore availability but still require immutable published content. */
export async function resolvePackageAuthority(client:Pool|PoolClient,id:string,newAssignment=false,options?:PackageSourceOptions) {
  const result=await client.query("SELECT * FROM package_revisions WHERE id=$1 AND status='published' FOR SHARE",[id])
  const row=result.rows[0] as Row|undefined
  if(!row || (newAssignment&&!row.available))throw new PackageError('package_unavailable')
  if(packageContentDigest(content(row))!==row.content_digest || row.validated_digest!==row.content_digest)throw new PackageError('package_authority_mismatch')
  const source=await client.query("SELECT source_sha256,solution FROM catalog_entries WHERE version=$1 AND status='published' FOR SHARE",[row.catalog_version])
  if(!source.rowCount||source.rows[0].source_sha256!==row.source_sha256)throw new PackageError('package_source_mismatch')
  const policy=derivePackagePolicy(source.rows[0].solution,row.catalog_tier,row.limits)
  if(newAssignment){assertPackageProvisionable(policy);await verifyPackageSource(options,row.source_sha256)}
  return packageAuthoritySchema.parse({schemaVersion:2,revisionId:row.id,digest:row.content_digest,catalog:{version:row.catalog_version,tier:row.catalog_tier,sourceSha256:row.source_sha256},policy})
}
export async function resolvePackageJobAuthority(pool:Pool,job:SharedJob) {
  if(job.operation!=='provision')return undefined
  return transaction(pool,client=>resolvePackageJobAuthorityInTransaction(client,job))
}
export async function resolvePackageJobAuthorityInTransaction(client:PoolClient,job:SharedJob) {
    if(job.operation!=='provision')return undefined
    const result=await client.query(`SELECT t.package_revision_id,t.catalog_version,t.catalog_tier FROM tenants t JOIN shared_jobs j ON j.control_tenant_id=t.id WHERE j.payload->>'requestId'=$1 AND j.payload->'binding'->>'tenantId'=$2 FOR SHARE OF t`,[job.requestId,job.binding.tenantId])
    if(!result.rowCount)throw new PackageError('package_authority_mismatch')
    const row=result.rows[0]
    if(!row.package_revision_id) {if(job.packageAuthority)throw new PackageError('package_authority_mismatch');return undefined}
    const trusted=await resolvePackageAuthority(client,row.package_revision_id)
    assertPackageJobAuthority(job.packageAuthority,trusted)
    assertPackageJobAuthority({catalog:job.catalog,policy:job.policy},{catalog:trusted.catalog,policy:trusted.policy})
    if(row.catalog_version!==trusted.catalog.version||row.catalog_tier!==trusted.catalog.tier)throw new PackageError('package_authority_mismatch')
    return trusted
}
