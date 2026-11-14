import type { PoolClient } from 'pg'
import type { Config } from '../config.js'
import type { RegistryActor } from './registry-store.js'

/** What the registry publication of a deletion may do: stop access (`retire`: disabled and retired) or undo that stop for a request withdrawn before the point of no return (`reinstate`). */
export type DeletionAuthorityMode = 'retire' | 'reinstate'
type Authority = { requestId: string; planDigest: string; mode: DeletionAuthorityMode }

// Object identity is a server capability, as for the commercial enrollment authority; an HTTP issuer/UID cannot forge it.
const authorities = new WeakMap<RegistryActor, Authority>()
export function tenantDeletionActor(config: Config, authority: Authority): RegistryActor {
  const actor = { issuer: `${config.installationId}:tenant-deletion`, actorUid: 1 }
  authorities.set(actor, authority)
  return actor
}
export const isTenantDeletionActor = (actor: RegistryActor) => authorities.has(actor)

/**
 * The persisted predicate, checked inside the publisher's own transaction with the request row locked `FOR SHARE` (a withdrawal takes it `FOR UPDATE`, so the
 * two serialize): `retire` needs the request `deleting`, not withdrawn, with the plan digest the runner froze; `reinstate` needs it withdrawn before the point
 * of no return with that same digest. The mutation itself must be exactly what the mode allows, and for this tenant only.
 */
export async function requireTenantDeletionAuthority(client: Pick<PoolClient, 'query'>, actor: RegistryActor, controlTenantId: string, target: { enabled: boolean; retired: boolean }) {
  const authority = authorities.get(actor)
  if (!authority) throw Error('tenant_deletion_forbidden')
  const wanted = authority.mode === 'retire' ? { enabled: false, retired: true } : { enabled: true, retired: false }
  if (target.enabled !== wanted.enabled || target.retired !== wanted.retired) throw Error('tenant_deletion_forbidden')
  const state = authority.mode === 'retire' ? "r.state='deleting' AND r.withdrawn_at IS NULL" : "r.state='withdrawn' AND r.committed_at IS NULL AND r.plan IS NOT NULL"
  const row = await client.query(`SELECT 1 FROM tenant_deletion_requests r JOIN customers c ON c.id=r.customer_id
    WHERE r.id=$1 AND c.tenant_id=$2 AND ${state} AND r.plan_digest=$3 FOR SHARE OF r`, [authority.requestId, controlTenantId, authority.planDigest])
  if (!row.rowCount) throw Error('tenant_deletion_forbidden')
}
