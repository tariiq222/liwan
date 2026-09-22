import { readFile } from 'node:fs/promises'
import type { Pool, PoolClient } from 'pg'

export async function migrate(pool: Pool): Promise<void> {
  const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8')
  const sql2 = await readFile(new URL('./schema_002.sql', import.meta.url), 'utf8')
  const sql3 = await readFile(new URL('./schema_003.sql', import.meta.url), 'utf8')
  await transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(1397969233)')
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
    const current = await client.query('SELECT version FROM schema_migrations WHERE version=1')
    if (!current.rowCount) {
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations(version) VALUES(1)')
    }
    const second = await client.query('SELECT version FROM schema_migrations WHERE version=2')
    if (!second.rowCount) {
      await client.query(sql2)
      await client.query('INSERT INTO schema_migrations(version) VALUES(2)')
    }
    const third = await client.query('SELECT version FROM schema_migrations WHERE version=3')
    if (!third.rowCount) {
      await client.query(sql3)
      await client.query('INSERT INTO schema_migrations(version) VALUES(3)')
    }
  })
}

export async function hasUnresolvedMutation(client: Pool | PoolClient, tenantId: string): Promise<boolean> {
  const result = await client.query(`SELECT 1 FROM operations
    WHERE tenant_id=$1 AND status='needs_intervention'
      AND type IN ('tenant.create','tenant.entitle','backup','upgrade','restore')
      AND NOT (type='tenant.create' AND stage='deployment_incomplete'
        AND result->>'status'='ok' AND result->>'policy_verified'='true'
        AND result->>'deployment_ready'='false')
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
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}
