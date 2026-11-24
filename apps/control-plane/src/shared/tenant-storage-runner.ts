import type { Pool } from 'pg'
import type { Config } from '../config.js'
import { runEffectChild, type EffectRunOptions } from './admin-password-runner.js'

/** Everything tenant_storage_effect.py can answer with: its own failure states and the codes of the effect gate and the shared runner. They name a check, never a value. */
export const TENANT_STORAGE_ERROR_CODES: ReadonlySet<string> = new Set([
  'oci_refused', 'oci_unreachable', 'key_not_valid', 'store_failed', 'limit_reached', 'bucket_mismatch',
  'request_invalid', 'operation_in_progress', 'authority_lost', 'script_failed',
  'runtime_invalid', 'runtime_command_failed', 'runtime_timeout',
])
/** A run is several container starts (Odoo shell, OCI calls) and never waits for a key: ten minutes is generous. */
const TENANT_STORAGE_TIMEOUT_MS = 10 * 60_000

/**
 * Runs tools/shared_saas_lifecycle/tenant_storage_effect.py for one provisioned SaaS tenant. The tenant slug, database and release binding come from the
 * enabled registry binding, never from the caller; the effect derives every OCI resource name from the slug itself. `request_id` is the id of this run.
 */
export function createTenantStorageRunner(pool: Pool, config: Config, opts: EffectRunOptions = {}) {
  return async (input: { tenant_id: string; operation: 'ensure' | 'verify' | 'rotate'; request_id: string; signal: AbortSignal }): Promise<unknown> => {
    const rows = await pool.query(`SELECT b.database_name,b.tenant_id AS "tenantId" FROM shared_registry_bindings b
      JOIN tenants t ON t.id=b.control_tenant_id
      WHERE b.control_tenant_id=$1 AND b.enabled=true AND t.commercial_mode='saas'`, [input.tenant_id])
    if (rows.rowCount !== 1) throw Error('tenant_binding_mismatch')
    const row = rows.rows[0]
    return runEffectChild({ config, effect: 'tenant_storage_effect', signal: input.signal, allowedCodes: TENANT_STORAGE_ERROR_CODES, timeoutMs: TENANT_STORAGE_TIMEOUT_MS, ...opts,
      request: { schemaVersion: 1, operation: input.operation, tenantId: row.tenantId, database: row.database_name, requestId: input.request_id } })
  }
}
