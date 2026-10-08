import { readFile } from 'node:fs/promises'
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

export function attachPoolErrorHandler(pool: Pool, onError: (error: Error) => void = () => {
  console.error('[control-plane] database pool connection error')
}): void {
  pool.on('error', (error: Error) => {
    try { onError(error) } catch { /* never let logging recreate an unhandled pool error */ }
  })
}

export async function migrate(pool: Pool): Promise<void> {
  const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8')
  const sql2 = await readFile(new URL('./schema_002.sql', import.meta.url), 'utf8')
  const sql3 = await readFile(new URL('./schema_003.sql', import.meta.url), 'utf8')
  const sql4 = await readFile(new URL('./schema_004.sql', import.meta.url), 'utf8')
  const sql5 = await readFile(new URL('./schema_005.sql', import.meta.url), 'utf8')
  const sql6 = await readFile(new URL('./schema_006.sql', import.meta.url), 'utf8')
  const sql7 = await readFile(new URL('./schema_007.sql', import.meta.url), 'utf8')
  const sql8 = await readFile(new URL('./schema_008.sql', import.meta.url), 'utf8')
  const sql11 = await readFile(new URL('./schema_011.sql', import.meta.url), 'utf8')
  const sql12 = await readFile(new URL('./schema_012.sql', import.meta.url), 'utf8')
  const sql13 = await readFile(new URL('./schema_013.sql', import.meta.url), 'utf8')
  const sql14 = await readFile(new URL('./schema_014.sql', import.meta.url), 'utf8')
  const sql15 = await readFile(new URL('./schema_015.sql', import.meta.url), 'utf8')
  const sql16 = await readFile(new URL('./schema_016.sql', import.meta.url), 'utf8')
  const sql17 = await readFile(new URL('./schema_017.sql', import.meta.url), 'utf8')
  const sql18 = await readFile(new URL('./schema_018.sql', import.meta.url), 'utf8')
  const sql19 = await readFile(new URL('./schema_019.sql', import.meta.url), 'utf8')
  const sql10 = await readFile(new URL('./schema_010.sql', import.meta.url), 'utf8')
  const sql9 = await readFile(new URL('./schema_009.sql', import.meta.url), 'utf8')
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
    const fourth = await client.query('SELECT version FROM schema_migrations WHERE version=4')
    if (!fourth.rowCount) {
      await client.query(sql4)
      await client.query('INSERT INTO schema_migrations(version) VALUES(4)')
    }
    const fifth = await client.query('SELECT version FROM schema_migrations WHERE version=5')
    if (!fifth.rowCount) {
      await client.query(sql5)
      await client.query('INSERT INTO schema_migrations(version) VALUES(5)')
    }
    const sixth = await client.query('SELECT version FROM schema_migrations WHERE version=6')
    if (!sixth.rowCount) {
      await client.query(sql6)
      await client.query('INSERT INTO schema_migrations(version) VALUES(6)')
    }
    const seventh = await client.query('SELECT version FROM schema_migrations WHERE version=7')
    if (!seventh.rowCount) {
      await client.query(sql7)
      await client.query('INSERT INTO schema_migrations(version) VALUES(7)')
    }
    const ninth = await client.query('SELECT version FROM schema_migrations WHERE version=9')
    const eighth = await client.query('SELECT version FROM schema_migrations WHERE version=8')
    if (!eighth.rowCount) {
      await client.query(sql8)
      await client.query('INSERT INTO schema_migrations(version) VALUES(8)')
    }
    if (!ninth.rowCount) {
      await client.query(sql9)
      await client.query('INSERT INTO schema_migrations(version) VALUES(9)')
    }
    const eleventh = await client.query('SELECT version FROM schema_migrations WHERE version=11')
    const tenth = await client.query('SELECT version FROM schema_migrations WHERE version=10')
    if (!tenth.rowCount) {
      await client.query(sql10)
      await client.query('INSERT INTO schema_migrations(version) VALUES(10)')
    }
    if (!eleventh.rowCount) {
      await client.query(sql11)
      await client.query('INSERT INTO schema_migrations(version) VALUES(11)')
    }
    const twelfth = await client.query('SELECT version FROM schema_migrations WHERE version=12')
    if (!twelfth.rowCount) {
      await client.query(sql12)
      await client.query('INSERT INTO schema_migrations(version) VALUES(12)')
    }
    const thirteenth = await client.query('SELECT version FROM schema_migrations WHERE version=13')
    if (!thirteenth.rowCount) {
      await client.query(sql13)
      await client.query('INSERT INTO schema_migrations(version) VALUES(13)')
    }
    const fourteenth = await client.query('SELECT version FROM schema_migrations WHERE version=14')
    if (!fourteenth.rowCount) {
      await client.query(sql14)
      await client.query('INSERT INTO schema_migrations(version) VALUES(14)')
    }
    const fifteenth = await client.query('SELECT version FROM schema_migrations WHERE version=15')
    if (!fifteenth.rowCount) {
      await client.query(sql15)
      await client.query('INSERT INTO schema_migrations(version) VALUES(15)')
    }
    const sixteenth = await client.query('SELECT version FROM schema_migrations WHERE version=16')
    if (!sixteenth.rowCount) {
      await client.query(sql16)
      await client.query('INSERT INTO schema_migrations(version) VALUES(16)')
    }
    for (const [version, body] of [[17, sql17], [18, sql18], [19, sql19]] as const) {
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
