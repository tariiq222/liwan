import { z } from 'zod'
import type { Pool, PoolClient } from 'pg'
import { registryTenantIdSchema } from '../shared/registry-store.js'

/** Whether a signed `x-liwan-tenant` value can name a workspace: a control tenant id or a registry tenant id. Format only, no lookup. */
export function isSignedTenantFormat(tenant: string): boolean {
  return z.uuid().safeParse(tenant).success || registryTenantIdSchema.safeParse(tenant).success
}
/** The control tenant a signed `x-liwan-tenant` value names, or null. The caller verifies the signature first.
 *  A value is resolved one way, by its shape: a UUID-shaped value is always a control tenant id (a dedicated web signs
 *  that), even when the registry id pattern also admits it; anything else is a registry tenant id (a shared web signs
 *  that), mapped through its enabled binding. Both branches refuse a disabled or retired shared tenant, and the UUID
 *  branch refuses an id the control plane does not hold, so a signature alone never names a workspace. */
export async function controlTenantForSigned(db: Pick<Pool | PoolClient, 'query'>, tenant: string): Promise<string | null> {
  if (z.uuid().safeParse(tenant).success) {
    const known = await db.query(
      'SELECT t.id FROM tenants t LEFT JOIN shared_registry_bindings b ON b.control_tenant_id=t.id WHERE t.id=$1 AND (b.control_tenant_id IS NULL OR b.enabled=true)', [tenant])
    return (known.rows[0]?.id as string | undefined) ?? null
  }
  if (!registryTenantIdSchema.safeParse(tenant).success) return null
  const bound = await db.query('SELECT control_tenant_id FROM shared_registry_bindings WHERE tenant_id=$1 AND enabled=true', [tenant])
  return (bound.rows[0]?.control_tenant_id as string | undefined) ?? null
}
