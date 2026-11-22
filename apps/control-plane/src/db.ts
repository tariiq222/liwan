import { readdir, readFile } from 'node:fs/promises'
import type { Pool, PoolClient } from 'pg'

export function isTransientDatabaseError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const candidate = error as Error & { code?: unknown }
  const stack = error.stack ?? ''
  if (candidate.code === undefined && error.constructor === Error && !('cause' in error) && error.message === 'Connection terminated unexpectedly' && stack.split('\n').some((line) => line.includes('at Connection.<anonymous>') && (line.includes('/pg/lib/client.js:') || line.includes('\\pg\\lib\\client.js:')))) return true
  return typeof candidate.code === 'string' && (
    /^08[0-9A-Z]{3}$/.test(candidate.code) ||
    ['57P01', '57P02', '57P03', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT'].includes(candidate.code)
  )
}

/** PostgreSQL rolled the transaction back because a concurrent one conflicted with it (deadlock 40P01, serialization failure 40001): nothing was written and the same request may be sent again. */
export function isConcurrencyAbort(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return code === '40P01' || code === '40001'
}

export function attachPoolErrorHandler(pool: Pool, onError: (error: Error) => void = () => {
  console.error('[control-plane] database pool connection error')
}): void {
  pool.on('error', (error: Error) => {
    try { onError(error) } catch { /* never let logging recreate an unhandled pool error */ }
  })
}

const MIGRATIONS_DIRECTORY = new URL('./migrations/', import.meta.url)
const MIGRATION_FILE = /^schema_(\d{3})\.sql$/
/** The numbering skips 40 and 41: no such migration was ever written. */
const SKIPPED_VERSIONS: ReadonlySet<number> = new Set([40, 41])

/** Every migration in the folder, by version. Throws before anything is applied when the folder is not a clean 1..N sequence. */
export async function loadMigrations(directory: URL = MIGRATIONS_DIRECTORY): Promise<Map<number, string>> {
  const files = new Map<number, string>()
  for (const name of (await readdir(directory)).sort()) {
    if (name.startsWith('.')) continue
    const match = MIGRATION_FILE.exec(name)
    if (!match) throw new Error(`migrations folder holds ${name}, which is not named schema_NNN.sql`)
    const version = Number(match[1])
    if (version < 1) throw new Error(`migration ${name} has no valid version: numbering starts at 001`)
    files.set(version, name)
  }
  if (!files.has(1)) throw new Error('migrations folder has no schema_001.sql')
  const last = Math.max(...files.keys())
  for (let version = 1; version <= last; version++) {
    if (!files.has(version) && !SKIPPED_VERSIONS.has(version)) throw new Error(`migrations folder has no file for version ${version}: schema_${String(version).padStart(3, '0')}.sql is missing`)
  }
  const migrations = new Map<number, string>()
  for (const [version, name] of [...files].sort(([a], [b]) => a - b)) migrations.set(version, await readFile(new URL(name, directory), 'utf8'))
  return migrations
}

export async function migrate(pool: Pool): Promise<void> {
  const migrations = await loadMigrations()
  await transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(1397969233)')
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
    for (const [version, body] of migrations) {
      if (!(await client.query(`SELECT version FROM schema_migrations WHERE version=${version}`)).rowCount) {
        await client.query(body)
        await client.query(`INSERT INTO schema_migrations(version) VALUES(${version})`)
      }
    }
  })
}

export function isScratchDeploymentExemption(result: Record<string, unknown>): boolean {
  return result.status === 'ok' && result.policy_verified === true && result.deployment_ready === false && result._control_lane === 'scratch'
}

export async function hasUnresolvedMutation(client: Pool | PoolClient, tenantId: string): Promise<boolean> {
  const result = await client.query(`SELECT 1 FROM operations
    WHERE tenant_id=$1 AND status='needs_intervention'
      AND type IN ('tenant.create','tenant.entitle','backup','upgrade','restore')
      AND NOT COALESCE(
        type='tenant.create' AND stage='deployment_incomplete'
        AND result->>'status'='ok' AND result->>'policy_verified'='true'
        AND jsonb_typeof(result->'deployment_ready')='boolean'
        AND result->'deployment_ready'='false'::jsonb
        AND result->>'_control_lane'='scratch',
        false
      )
    LIMIT 1`, [tenantId])
  return Boolean(result.rowCount)
}

export async function transaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await action(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try { await client.query('ROLLBACK') } catch { /* retain the operation's original failure */ }
    throw error
  } finally { client.release() }
}
