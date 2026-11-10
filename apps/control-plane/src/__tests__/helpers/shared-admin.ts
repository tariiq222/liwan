import type { TenantStorage } from '../../shared/fenced-adapter.js'
import { ensureAdminBindingSchema } from '../../shared/fenced-adapter.js'

/** Fixture: the first-administrator row backup and restore carry, bound to its provisioning request. */
export async function bindAdminRow(storage: TenantStorage, input: { tenantId: string; requestId: string; login: string }): Promise<void> {
  await ensureAdminBindingSchema(storage)
  await storage.pool.query('INSERT INTO shared_admin(tenant_id,request_id,login) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [input.tenantId, input.requestId, input.login])
}
