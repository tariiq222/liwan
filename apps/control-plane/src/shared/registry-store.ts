import type { Pool, PoolClient } from 'pg'
import { z } from 'zod'
import { withPublicationLock, beginPublication, completePublication } from './registry-publisher.js'

const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1)
const resource = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/)
export const registryTargetSchema = z.strictObject({
  host: z.string().max(253).regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/),
  tenantId: z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/), database: resource, filestore: resource,
  enabled: z.boolean(), registryRevision: revision.refine(n => n > 0),
}).refine(t => t.database === t.filestore)
export const registryMutationSchema = z.strictObject({ controlTenantId: z.uuid(), expectedSnapshotRevision: revision, target: registryTargetSchema, reason: z.string().trim().min(3).max(1000) })
export type RegistryActor = { issuer: string; actorUid: number }
export class RegistryError extends Error {
  constructor(public code: string, public status = 409) { super(code) }
}
/** The advisory lock every registry publication takes, and that a restore holds
 * while it owns an approved target. One definition: a restore and a publication
 * must contend on the same key. */
export const REGISTRY_ADVISORY_LOCK = 1397969234
const LOCK = REGISTRY_ADVISORY_LOCK
const fields = 'tenant_id AS "tenantId",host,database_name AS database,filestore,enabled,registry_revision::float8 AS "registryRevision"'
async function authorize(client: PoolClient, actor: RegistryActor) {
  if (!actor.issuer || !Number.isSafeInteger(actor.actorUid) || actor.actorUid < 1) throw new RegistryError('registry_forbidden', 403)
  const grant = await client.query("SELECT 1 FROM vendor_memberships WHERE issuer=$1 AND actor_uid=$2 AND revoked_at IS NULL AND 'vendor.tenants.manage'=ANY(capabilities) FOR SHARE", [actor.issuer, actor.actorUid])
  if (!grant.rowCount) throw new RegistryError('registry_forbidden', 403)
}
export async function resolveRegistryBinding(client: PoolClient, controlTenantId: string) {
  const result = await client.query(`SELECT ${fields} FROM shared_registry_bindings WHERE control_tenant_id=$1 FOR SHARE`, [controlTenantId])
  if (!result.rowCount) throw new RegistryError('tenant_binding_unavailable', 404)
  const { host: _host, ...binding } = registryTargetSchema.parse(result.rows[0])
  return binding
}
async function snapshot(client: PoolClient) {
  const state = await client.query('SELECT revision::float8 AS revision FROM shared_registry_state WHERE singleton=true')
  const targets = await client.query(`SELECT ${fields} FROM shared_registry_bindings ORDER BY tenant_id`)
  if (!state.rowCount) throw new RegistryError('registry_state_unavailable', 503)
  // Revision zero / empty targets is a deny-all bootstrap artifact. Runtime
  // readers reject it, but recovery can finish and a new authorized create can proceed.
  return { schemaVersion: 1 as const, snapshotRevision: revision.parse(state.rows[0].revision), targets: targets.rows.map(t => registryTargetSchema.parse(t)) }
}
async function locked<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  let held = false
  let broken = false
  try { await client.query('SELECT pg_advisory_lock($1)', [LOCK]); held = true; return await action(client) }
  catch (error) { try { await client.query('ROLLBACK') } catch { broken = true }; throw error }
  finally {
    if (held) { try { await client.query('SELECT pg_advisory_unlock($1)', [LOCK]) } catch { broken = true } }
    client.release(broken)
  }
}
export async function publishRegistryMutation(pool: Pool, path: string, actor: RegistryActor, value: unknown) {
  const input = registryMutationSchema.parse(value)
  return withPublicationLock(path, () => locked(pool, async client => {
    await client.query('BEGIN')
    await authorize(client, actor)
    const state = await client.query('SELECT revision::float8 AS revision FROM shared_registry_state WHERE singleton=true FOR UPDATE')
    if (state.rows[0]?.revision !== input.expectedSnapshotRevision) throw new RegistryError('registry_revision_conflict')
    if (input.expectedSnapshotRevision >= Number.MAX_SAFE_INTEGER - 1) throw new RegistryError('registry_revision_exhausted')
    const owner = await client.query("SELECT id FROM tenants WHERE id=$1 AND commercial_mode='saas' FOR SHARE", [input.controlTenantId])
    if (!owner.rowCount) throw new RegistryError('tenant_binding_unavailable', 404)
    const old = await client.query(`SELECT ${fields} FROM shared_registry_bindings WHERE control_tenant_id=$1 FOR UPDATE`, [input.controlTenantId])
    const previous = old.rowCount ? registryTargetSchema.parse(old.rows[0]) : null
    const target = input.target
    if (previous && (previous.tenantId !== target.tenantId || previous.database !== target.database || previous.filestore !== target.filestore)) throw new RegistryError('tenant_binding_immutable')
    if (target.registryRevision !== (previous?.registryRevision ?? 0) + 1) throw new RegistryError('registry_revision_conflict')
    const reserved = await client.query('SELECT control_tenant_id FROM shared_registry_hosts WHERE host=$1', [target.host])
    if (reserved.rowCount && reserved.rows[0].control_tenant_id !== input.controlTenantId) throw new RegistryError('registry_host_reserved')
    // Barrier precedes SQL writes/commit. Any subsequent failure requires explicit recovery.
    await beginPublication(path)
    if (previous) {
      await client.query('UPDATE shared_registry_bindings SET host=$1,enabled=$2,registry_revision=$3 WHERE control_tenant_id=$4', [target.host,target.enabled,target.registryRevision,input.controlTenantId])
    } else {
      await client.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$5,$6,$7)', [input.controlTenantId,target.tenantId,target.host,target.database,target.filestore,target.enabled,target.registryRevision])
    }
    await client.query('INSERT INTO shared_registry_hosts(host,control_tenant_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [target.host,input.controlTenantId])
    const next = input.expectedSnapshotRevision + 1
    await client.query('UPDATE shared_registry_state SET revision=$1 WHERE singleton=true', [next])
    await client.query('INSERT INTO shared_registry_audit(snapshot_revision,control_tenant_id,actor_uid,issuer,reason,before_target,after_target) VALUES($1,$2,$3,$4,$5,$6,$7)', [next,input.controlTenantId,actor.actorUid,actor.issuer,input.reason,previous,target])
    await client.query('COMMIT')
    const current = await snapshot(client)
    await completePublication(path, current)
    return current
  }))
}
export async function recoverRegistry(pool: Pool, path: string, actor: RegistryActor, reason: string) {
  z.string().trim().min(3).max(1000).parse(reason)
  return withPublicationLock(path, () => locked(pool, async client => {
    await client.query('BEGIN')
    await authorize(client, actor)
    const current = await snapshot(client)
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5)', [actor.issuer + ':' + actor.actorUid,'registry.recovery_requested','shared-registry',reason,{ snapshotRevision: current.snapshotRevision }])
    await client.query('COMMIT')
    // Recovery requires an existing barrier; it cannot overwrite a healthy publication.
    await completePublication(path, current)
    return current
  }))
}
