// Shared scratch-tenant helpers for the live-PostgreSQL suites. The suites must
// run anywhere a control scratch database is provided (CI included), so tenant
// database names are DERIVED from the control database's own scratch suffix
// instead of being hard-coded to one local environment, and are created on
// demand. Names stay inside the registry resource pattern
// (^[a-z][a-z0-9_]{0,62}$) and the 63-byte PostgreSQL identifier limit.
import type { Pool } from 'pg'

const CONTROL_SUFFIX = /^webvue_control_scratch_([a-z0-9]+)$/
const TENANT_NAME = /^[a-z][a-z0-9_]{0,62}$/

/** Derive `count` tenant database names from the control URL's scratch suffix. */
export function tenantDatabaseNames(count: number, controlUrl: string): string[] {
  if (!Number.isSafeInteger(count) || count < 1 || count > 50) throw new Error('tenant_count_invalid')
  const database = new URL(controlUrl).pathname.slice(1)
  const match = CONTROL_SUFFIX.exec(database)
  if (!match) throw new Error('control_database_must_be_scratch')
  return Array.from({ length: count }, (_, index) => `webvue_shared_scratch_${match[1]}_t${String(index + 1).padStart(2, '0')}`)
}

/** Create any missing tenant scratch database; existing ones are reused as is. */
export async function ensureTenantDatabases(pool: Pool, names: readonly string[]): Promise<void> {
  for (const name of names) {
    if (!TENANT_NAME.test(name) || name.length > 63) throw new Error(`tenant_database_name_invalid: ${name}`)
    const existing = await pool.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])
    if (existing.rowCount) continue
    // Identifier is pattern-validated above; no caller input reaches this SQL.
    await pool.query(`CREATE DATABASE "${name}"`)
  }
}
