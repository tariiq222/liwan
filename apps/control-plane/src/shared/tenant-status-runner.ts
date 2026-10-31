import { spawn } from 'node:child_process'
import type { Pool } from 'pg'
import type { Config } from '../config.js'
import type { TenantStatus } from '../commercial/suspension.js'
import { runEffectChild } from './admin-password-runner.js'

const allowed = new Set(['database_invalid', 'profile_invalid', 'script_failed'])
/** The effect writes a few rows and commits; a minute covers the container start. */
const TENANT_STATUS_TIMEOUT_MS = 180_000

/**
 * Runs tools/shared_saas_lifecycle/tenant_status_effect.py for one provisioned tenant: sets its Odoo profile
 * status to `active` or `suspended`. The database comes from the enabled registry binding, never from the caller.
 */
export function createTenantStatusRunner(pool: Pool, config: Config, runtime: unknown, signal: AbortSignal, spawnChild: typeof spawn = spawn, opts: { timeoutMs?: number; killGraceMs?: number } = {}) {
  return async (input: { tenant_id: string; status: TenantStatus }): Promise<unknown> => {
    const rows = await pool.query(`SELECT b.database_name,b.host,b.tenant_id AS "tenantId",b.filestore,b.registry_revision::float8 AS "registryRevision" FROM shared_registry_bindings b
      JOIN tenants t ON t.id=b.control_tenant_id
      WHERE b.control_tenant_id=$1 AND b.enabled=true AND t.commercial_mode='saas'`, [input.tenant_id])
    if (rows.rowCount !== 1) throw Error('tenant_binding_mismatch')
    const row = rows.rows[0]
    return runEffectChild({ config, spawnChild, module: 'tools.shared_saas_lifecycle.tenant_status_effect', signal, allowedCodes: allowed, timeoutMs: TENANT_STATUS_TIMEOUT_MS, ...opts,
      request: { action: 'set_tenant_status', tenant: { database: row.database_name, host: row.host },
        releaseBinding: { tenantId: row.tenantId, database: row.database_name, filestore: row.filestore, registryRevision: row.registryRevision }, status: input.status, config: runtime } })
  }
}
