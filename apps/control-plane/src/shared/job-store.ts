import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { z } from 'zod'
import { sharedPolicySchema, type TenantBinding } from '@nasq/commercial-contracts/shared'
import { transaction } from '../db.js'
import { resolveRegistryBinding, type RegistryActor } from './registry-store.js'
import { bindJob, businessKey, payloadDigest } from './provisioning.js'

export function deriveSharedPolicy(value: unknown, tierId: string) {
  const catalog = z.object({ base_modules: z.array(z.string()), tiers: z.array(z.object({ id: z.string(), modules: z.array(z.string()), features: z.array(z.string()) })) }).parse(value)
  const tier = catalog.tiers.find(t => t.id === tierId)
  if (!tier) throw new Error('catalog_tier_missing')
  const features: Record<string, boolean | null> = { 'users.limit': null, 'storage.limit_mb': null }
  for (const entry of tier.features) {
    const parts = entry.split(':')
    if (parts.length !== 2 || !['boolean', 'limit'].includes(parts[0]!)) throw new Error('catalog_feature_invalid')
    features[parts[1]!] = parts[0] === 'boolean' ? true : null
  }
  return sharedPolicySchema.parse({ schema_version: 1, channel: 'control_plane', modules: [...catalog.base_modules, ...tier.modules], features })
}
export function bindQueuedRequest(input: unknown, target: TenantBinding & { enabled: boolean }) {
  if (!target.enabled) throw new Error('tenant_unavailable')
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.hasOwn(input, 'binding')) throw new Error('caller_binding_forbidden')
  const { enabled: _enabled, ...binding } = target
  return bindJob({ ...input, binding })
}
export async function requireJobAuthority(client: PoolClient, controlTenantId: string, actor: RegistryActor) {
  if (!Number.isSafeInteger(actor.actorUid) || actor.actorUid <= 0 || !actor.issuer) throw new Error('shared_job_forbidden')
  const grant = await client.query("SELECT 1 FROM vendor_memberships WHERE issuer=$1 AND actor_uid=$2 AND revoked_at IS NULL AND 'vendor.operations.run'=ANY(capabilities) FOR SHARE", [actor.issuer,actor.actorUid])
  if (!grant.rowCount) throw new Error('shared_job_forbidden')
  const tenant = await client.query("SELECT id FROM tenants WHERE id=$1 AND commercial_mode='saas' AND operations_enabled=true FOR SHARE", [controlTenantId])
  if (!tenant.rowCount) throw new Error('tenant_operations_unavailable')
}
export async function enqueueSharedJob(pool: Pool, controlTenantId: string, actor: RegistryActor, value: unknown, reason: string) {
  z.uuid().parse(controlTenantId); z.string().trim().min(3).max(1000).parse(reason)
  return transaction(pool, async client => {
    await requireJobAuthority(client, controlTenantId, actor)
    const target = await resolveRegistryBinding(client, controlTenantId)
    // Provision callers supply only the operation/request ID. Catalog and policy
    // are selected from the enrolled tenant and immutable published catalog.
    let authoritative = value
    if (value && typeof value === 'object' && (value as { operation?: unknown }).operation === 'provision') {
      const request = z.strictObject({ schemaVersion: z.literal(1), operation: z.literal('provision'), requestId: z.uuid() }).parse(value)
      const tenant = await client.query('SELECT catalog_version,catalog_tier FROM tenants WHERE id=$1 FOR SHARE', [controlTenantId])
      const version = tenant.rows[0]?.catalog_version, tier = tenant.rows[0]?.catalog_tier
      if (!version || !tier) throw new Error('catalog_required')
      const catalog = await client.query("SELECT source_sha256,solution FROM catalog_entries WHERE version=$1 AND status='published' FOR SHARE", [version])
      if (!catalog.rowCount) throw new Error('published_catalog_missing')
      authoritative = { ...request, catalog: { version, tier, sourceSha256: catalog.rows[0].source_sha256 }, policy: deriveSharedPolicy(catalog.rows[0].solution, tier) }
    }
    const job = bindQueuedRequest(authoritative, target)
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
      // Existing dedicated approval IDs refer to a different backup receipt format.
      // Do not reinterpret them or accept the caller's verified-backup assertion.
      throw new Error('shared_restore_authority_unavailable')
    }
    const id = randomUUID()
    await client.query('INSERT INTO shared_jobs(id,control_tenant_id,business_key,payload,payload_digest,issuer,actor_uid,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [id,controlTenantId,key,job,digest,actor.issuer,actor.actorUid,reason])
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason) VALUES($1,$2,$3,$4,$5)', [randomUUID(),actor.issuer+':'+actor.actorUid,'shared_job.queued',id,reason])
    return { id, state: 'queued', replay: false }
  })
}
