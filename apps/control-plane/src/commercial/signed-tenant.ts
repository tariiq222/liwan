import { z } from 'zod'
import type { Pool, PoolClient } from 'pg'
import { registryTenantIdSchema } from '../shared/registry-store.js'

/** Whether a signed `x-liwan-tenant` value can name a workspace: a control tenant id or a registry tenant id. Format only, no lookup. */
export function isSignedTenantFormat(tenant: string): boolean {
  return z.uuid().safeParse(tenant).success || registryTenantIdSchema.safeParse(tenant).success
}
/** The control tenant a signed `x-liwan-tenant` value names, or null. A shared web signs the registry tenant id, which the enabled
 * binding maps to its control tenant; a dedicated web signs the control tenant id itself. The caller verifies the signature first. */
export async function controlTenantForSigned(db: Pick<Pool | PoolClient, 'query'>, tenant: string): Promise<string | null> {
  if (z.uuid().safeParse(tenant).success) return tenant
  if (!registryTenantIdSchema.safeParse(tenant).success) return null
  const bound = await db.query('SELECT control_tenant_id FROM shared_registry_bindings WHERE tenant_id=$1 AND enabled=true', [tenant])
  return (bound.rows[0]?.control_tenant_id as string | undefined) ?? null
}
