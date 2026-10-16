import { actorHolds } from '../admin-auth/grants.js'
import { isCommercialEnrollmentActor, requireCommercialEnrollmentAuthority } from './commercial-enrollment-authority.js'
import { resolvePackageAuthority } from '../packages.js'
import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { z } from 'zod'
import { sharedPolicySchema, type TenantBinding } from '@nasq/commercial-contracts/shared'
import { transaction } from '../db.js'
import { derivePolicy } from './catalog-features.js'
import { resolveRegistryBinding, type RegistryActor } from './registry-store.js'
import { bindJob, businessKey, payloadDigest, assertSameBinding } from './provisioning.js'
import type { TenantStorage } from './fenced-adapter.js'
import { assertRestoreTargetInspectable, assertRestoreTargetUnreserved } from './shared-backup.js'

/** Restore enqueues may carry the caller's tenant-database connector so the
 * approved target can be inspected before anything is queued. */
export type SharedEnqueueOptions = { connect?: (database: string) => Promise<TenantStorage> }

// Restore callers supply only the approval ID; the binding, backup identity
// and verified digests are derived here from the durable approval authority.
const restoreInputSchema = z.strictObject({
  schemaVersion: z.literal(1), requestId: z.uuid(), operation: z.literal('restore'), approvalId: z.uuid(),
})

export function deriveSharedPolicy(value: unknown, tierId: string) {
  const catalog = z.object({ base_modules: z.array(z.string()), tiers: z.array(z.object({ id: z.string(), modules: z.array(z.string()) }).passthrough()) }).passthrough().parse(value)
  const tier = catalog.tiers.find(t => t.id === tierId)
  if (!tier) throw new Error('catalog_tier_missing')
  const { modules, features } = derivePolicy(value, tier.id)
  return sharedPolicySchema.parse({ schema_version: 1, channel: 'control_plane', modules, features })
}
export function bindQueuedRequest(input: unknown, target: TenantBinding & { enabled: boolean }) {
  if (!target.enabled) throw new Error('tenant_unavailable')
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.hasOwn(input, 'binding')) throw new Error('caller_binding_forbidden')
  const { enabled: _enabled, ...binding } = target
  return bindJob({ ...input, binding })
}
export async function requireJobAuthority(client: PoolClient, controlTenantId: string, actor: RegistryActor) {
  if (!Number.isSafeInteger(actor.actorUid) || actor.actorUid <= 0 || !actor.issuer) throw new Error('shared_job_forbidden')
  if (isCommercialEnrollmentActor(actor)) await requireCommercialEnrollmentAuthority(client, actor, controlTenantId)
  else {
    if (!await actorHolds(client, actor, ['vendor.operations.run'], true)) throw new Error('shared_job_forbidden')
  }
  const tenant = await client.query("SELECT id FROM tenants WHERE id=$1 AND commercial_mode='saas' AND operations_enabled=true FOR SHARE", [controlTenantId])
  if (!tenant.rowCount) throw new Error('tenant_operations_unavailable')
}
/** Internal paid-order path: authority comes from locked commercial records, not a vendor/browser actor. */
export async function enqueueReconfigureJob(client: PoolClient, value: unknown) {
  const { sharedReconfigureJobSchema } = await import('@nasq/commercial-contracts/shared')
  const { createHash } = await import('node:crypto')
  const job = sharedReconfigureJobSchema.parse(value)
  const key = `${job.controlTenantId}:${job.authority.target_revision_id}${job.restore ? ':restore:'+job.restoreId : ''}`
  const digest = createHash('sha256').update(JSON.stringify(job)).digest('hex')
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [job.controlTenantId])
  const existing = await client.query('SELECT id,state,payload FROM shared_jobs WHERE control_tenant_id=$1 AND business_key=$2', [job.controlTenantId,key])
  if (existing.rowCount) {
    if (existing.rows[0].payload.authority.target_revision_id !== job.authority.target_revision_id || existing.rows[0].payload.authority.entitlement.digest !== job.authority.entitlement.digest) throw Error('idempotency_conflict')
    return { id: existing.rows[0].id as string, state: existing.rows[0].state as string, replay: true }
  }
  const id=randomUUID()
  await client.query('INSERT INTO shared_jobs(id,control_tenant_id,business_key,payload,payload_digest,issuer,actor_uid,reason) VALUES($1,$2,$3,$4,$5,$6,1,$7)',[id,job.controlTenantId,key,job,digest,'commercial-fulfillment',job.restore?'Reconcile restored commercial revision':'Apply paid subscription revision'])
  return {id,state:'queued',replay:false}
}

export async function enqueueSharedJob(pool: Pool, controlTenantId: string, actor: RegistryActor, value: unknown, reason: string, options: SharedEnqueueOptions = {}) {
  z.uuid().parse(controlTenantId); z.string().trim().min(3).max(1000).parse(reason)
  return transaction(pool, async client => {
    await requireJobAuthority(client, controlTenantId, actor)
    const target = await resolveRegistryBinding(client, controlTenantId)
    // Provision callers supply only the operation/request ID. Catalog and policy
    // are selected from the enrolled tenant and immutable published catalog.
    let authoritative = value
    let restoreTarget = ''
    let restoreApprovalAvailable = false
    if (value && typeof value === 'object' && (value as { operation?: unknown }).operation === 'provision') {
      const request = z.strictObject({ schemaVersion: z.literal(1), operation: z.literal('provision'), requestId: z.uuid() }).parse(value)
      const tenant = await client.query('SELECT catalog_version,catalog_tier,package_revision_id FROM tenants WHERE id=$1 FOR SHARE', [controlTenantId])
      const version = tenant.rows[0]?.catalog_version, tier = tenant.rows[0]?.catalog_tier
      if (!version || !tier) throw new Error('catalog_required')
      const catalog = await client.query("SELECT source_sha256,solution FROM catalog_entries WHERE version=$1 AND status='published' FOR SHARE", [version])
      if (!catalog.rowCount) throw new Error('published_catalog_missing')
      const packageAuthority = tenant.rows[0].package_revision_id ? await resolvePackageAuthority(client,tenant.rows[0].package_revision_id) : undefined
      authoritative = { ...request, catalog: { version, tier, sourceSha256: catalog.rows[0].source_sha256 }, policy: packageAuthority?.policy??deriveSharedPolicy(catalog.rows[0].solution, tier), ...(packageAuthority?{packageAuthority}:{}) }
    }
    if (value && typeof value === 'object' && (value as { operation?: unknown }).operation === 'restore') {
      const request = restoreInputSchema.parse(value)
      if (!target.enabled) throw new Error('tenant_unavailable')
      const approval = await client.query(`SELECT a.control_tenant_id AS approval_tenant_id,a.backup_id,a.target_database,
          (a.consumed_at IS NULL AND a.expires_at>clock_timestamp()) AS approval_available,
          b.control_tenant_id AS backup_tenant_id,b.tenant_id,b.database_name,b.filestore,b.database_sha256,b.filestore_sha256
        FROM shared_restore_approvals a JOIN shared_backups b ON b.id=a.backup_id
        WHERE a.id=$1 AND b.consistency='verified' FOR UPDATE OF a`, [request.approvalId])
      if (!approval.rowCount) throw new Error('shared_restore_approval_unavailable')
      const row = approval.rows[0]
      if (row.approval_tenant_id !== controlTenantId || row.backup_tenant_id !== controlTenantId) throw new Error('shared_restore_approval_unavailable')
      restoreTarget = row.target_database as string
      restoreApprovalAvailable = row.approval_available === true
      const { enabled: _enabled, ...binding } = target
      // The full payload is constructed server-side: no caller-supplied binding,
      // backup or digest ever enters the job. A source identity that no longer
      // matches the registry binding fails closed in bindJob.
      authoritative = { ...request, binding, backup: {
        schemaVersion: 1, backupId: row.backup_id,
        binding: { tenantId: row.tenant_id, database: row.database_name, filestore: row.filestore, registryRevision: binding.registryRevision },
        databaseSha256: row.database_sha256, filestoreSha256: row.filestore_sha256, consistency: 'verified',
      } }
    }
    if (!target.enabled && authoritative && typeof authoritative === 'object' && (authoritative as {operation?:unknown}).operation === 'provision') {
      const onboarding = await client.query("SELECT 1 FROM shared_onboardings WHERE control_tenant_id=$1 AND request_id=$2 AND issuer=$3 AND actor_uid=$4 AND tenant_slug=$5 AND database_name=$6 AND stage IN ('reserved','queued') FOR UPDATE", [controlTenantId,(authoritative as {requestId:string}).requestId,actor.issuer,actor.actorUid,target.tenantId,target.database])
      if (onboarding.rowCount) target.enabled = true
    }
    const job = value && typeof value === 'object' && (value as { operation?: unknown }).operation === 'restore'
      ? bindJob(authoritative)
      : bindQueuedRequest(authoritative, target)
    const key = businessKey(job), digest = payloadDigest(job)
    // Serialize enqueue/approval consumption for this tenant, in addition to SQL uniqueness.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [controlTenantId])
    const existing = await client.query('SELECT id,payload_digest,state,issuer,actor_uid FROM shared_jobs WHERE control_tenant_id=$1 AND business_key=$2', [controlTenantId,key])
    if (existing.rowCount) {
      if (existing.rows[0].issuer !== actor.issuer || Number(existing.rows[0].actor_uid) !== actor.actorUid) throw new Error('shared_replay_forbidden')
      if (existing.rows[0].payload_digest !== digest) throw new Error('idempotency_conflict')
      await client.query('INSERT INTO audit_events(id,actor,action,subject,reason) VALUES($1,$2,$3,$4,$5)', [randomUUID(),actor.issuer+':'+actor.actorUid,'shared_job.replayed',existing.rows[0].id,reason])
      return { id: existing.rows[0].id as string, state: existing.rows[0].state as string, replay: true }
    }
    // Consumption/expiry prohibit a NEW effect, not an authenticated exact
    // replay of the immutable job above. Source/approval/actor/digest were
    // reconstructed and compared before reaching this point.
    if (job.operation === 'restore' && !restoreApprovalAvailable) throw new Error('shared_restore_approval_unavailable')
    const unresolved = await client.query("SELECT id FROM shared_jobs WHERE control_tenant_id=$1 AND state IN ('running','needs_intervention') LIMIT 1", [controlTenantId])
    if (unresolved.rowCount) throw new Error('shared_reconciliation_required')
    if (job.operation === 'provision') {
      const catalog = await client.query("SELECT source_sha256,solution FROM catalog_entries WHERE version=$1 AND status='published' FOR SHARE", [job.catalog.version])
      const entry = catalog.rows[0]
      const tier = entry?.solution?.tiers?.find((t: { id: string }) => t.id === job.catalog.tier)
      if (!tier || entry.source_sha256 !== job.catalog.sourceSha256) throw new Error('catalog_mismatch')
      // Policy above was derived from this transaction's locked published catalog.
    }
    if (job.operation === 'restore') {
      // One approval authorizes exactly one queued job: a second job (different
      // request ID) for the same approval can never legitimately consume it.
      const duplicate = await client.query("SELECT 1 FROM shared_jobs WHERE control_tenant_id=$1 AND payload->>'approvalId'=$2 AND business_key<>$3 LIMIT 1", [controlTenantId, job.approvalId, key])
      if (duplicate.rowCount) throw new Error('shared_restore_approval_unavailable')
      // The approved target must still be a NEW database. This is decided
      // before any row is inserted, so a predictable, preventable restore can
      // never leave a queued job that later needs intervention. Replays return
      // above, so an identical retry stays idempotent.
      if (!restoreTarget) throw new Error('shared_restore_approval_unavailable')
      await assertRestoreTargetUnreserved(client, restoreTarget)
      const real=await client.query('SELECT source_binding,target_database FROM shared_odoo_restore_targets WHERE approval_id=$1',[job.approvalId])
      if(real.rowCount){
        if(real.rows[0].target_database!==restoreTarget)throw Error('shared_restore_approval_unavailable')
        assertSameBinding(job.binding,real.rows[0].source_binding)
      }else await assertRestoreTargetInspectable(options.connect, restoreTarget)
    }
    const id = randomUUID()
    await client.query('INSERT INTO shared_jobs(id,control_tenant_id,business_key,payload,payload_digest,issuer,actor_uid,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [id,controlTenantId,key,job,digest,actor.issuer,actor.actorUid,reason])
    if (job.operation === 'provision') await client.query("UPDATE shared_onboardings SET job_id=$1,job_digest=$2,stage='queued',error_code=NULL WHERE control_tenant_id=$3 AND request_id=$4 AND issuer=$5 AND actor_uid=$6 AND job_id IS NULL", [id,digest,controlTenantId,job.requestId,actor.issuer,actor.actorUid])
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason) VALUES($1,$2,$3,$4,$5)', [randomUUID(),actor.issuer+':'+actor.actorUid,'shared_job.queued',id,reason])
    return { id, state: 'queued', replay: false }
  })
}
