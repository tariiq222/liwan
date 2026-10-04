import type { PoolClient } from 'pg'
import type { Config } from '../config.js'
import type { RegistryActor } from './registry-store.js'

// Object identity is a server capability; an HTTP issuer/UID cannot forge it.
const authorities = new WeakMap<RegistryActor, string>()
export function commercialEnrollmentActor(config: Config, requestId: string): RegistryActor {
  const actor = { issuer: `${config.installationId}:commercial-fulfillment`, actorUid: 1 }
  authorities.set(actor, requestId)
  return actor
}
export function isCommercialEnrollmentActor(actor: RegistryActor) { return authorities.has(actor) }
/** Single durable paid-new-order rule, reused by dispatcher SQL and locked worker/
 * onboarding/registry checks. SQL expressions are internal constants, never input.
 * No schema view/function exists: keep this predicate authoritative here. */
export function commercialEnrollmentAuthoritySql(requestId: string) {
  return `SELECT 1 FROM customers c JOIN subscriptions s ON s.customer_id=c.id JOIN orders o ON o.subscription_id=s.id
    WHERE c.enrollment_request_id::text=${requestId} AND c.admin_login IS NOT NULL AND o.kind='new'
    AND o.payment_state IN ('paid','not_required') AND NOT o.cancelled
    AND o.target_revision_id IN (s.target_revision_id,s.applied_revision_id)
    AND (c.tenant_id IS NULL OR c.tenant_id::text=${requestId}) AND (s.tenant_id IS NULL OR s.tenant_id::text=${requestId})`
}
/** Persisted service authority is provision-only and must match the linked tenant,
 * request, and original onboarding actor. An issuer suffix alone is never enough. */
export function commercialProvisionAuthoritySql() {
  return `queued.payload->>'operation'='provision' AND queued.issuer LIKE '%:commercial-fulfillment' AND queued.actor_uid=1
    AND queued.control_tenant_id::text=queued.payload->>'requestId'
    AND EXISTS (SELECT 1 FROM shared_onboardings enrollment WHERE enrollment.control_tenant_id=queued.control_tenant_id
      AND enrollment.request_id::text=queued.payload->>'requestId' AND enrollment.issuer=queued.issuer AND enrollment.actor_uid=queued.actor_uid)
    AND EXISTS (${commercialEnrollmentAuthoritySql("queued.payload->>'requestId'")}
      AND c.tenant_id=queued.control_tenant_id AND s.tenant_id=queued.control_tenant_id)`
}
export async function requireCommercialEnrollmentAuthority(client: PoolClient, actor: RegistryActor, tenantId?: string) {
  const requestId = authorities.get(actor)
  if (!requestId || (tenantId && tenantId !== requestId)) throw Error('commercial_enrollment_forbidden')
  const row = await client.query(`${commercialEnrollmentAuthoritySql('$1')} FOR SHARE OF c,s,o`, [requestId])
  if (!row.rowCount) throw Error('commercial_enrollment_forbidden')
}
/** Reconstitute only inside the trusted worker, never from an HTTP actor. */
export function provisioningActor(config: Config, row: { issuer: string; actor_uid: number | string; request_id: string }): RegistryActor {
  return row.issuer === `${config.installationId}:commercial-fulfillment` && Number(row.actor_uid) === 1
    ? commercialEnrollmentActor(config, row.request_id)
    : { issuer: row.issuer, actorUid: Number(row.actor_uid) }
}
