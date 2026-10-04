import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'

export type OutboxRow = {
  id: string; kind: string; aggregate_id: string; dedupe_key: string; payload: unknown
  status: 'pending' | 'done' | 'failed'; created_at: Date; processed_at: Date | null
}

export async function enqueueOutbox(
  client: Pick<PoolClient, 'query'>,
  { kind, aggregate_id, dedupe_key, payload }: { kind: string; aggregate_id: string; dedupe_key: string; payload: unknown },
): Promise<boolean> {
  const r = await client.query(
    `INSERT INTO commercial_outbox(id, kind, aggregate_id, dedupe_key, payload) VALUES($1,$2,$3,$4,$5::jsonb)
     ON CONFLICT DO NOTHING RETURNING id`,
    [randomUUID(), kind, aggregate_id, dedupe_key, JSON.stringify(payload ?? {})],
  )
  return (r.rowCount ?? 0) > 0
}

/** Returns pending rows locked only for the duration of the selecting transaction; caller completes/fails them. */
export async function claimOutbox(pool: Pool, kinds: string[], limit: number): Promise<OutboxRow[]> {
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    const r = await c.query(
      `SELECT * FROM commercial_outbox WHERE status='pending' AND kind = ANY($1::text[])
       ORDER BY created_at, id LIMIT $2 FOR UPDATE SKIP LOCKED`,
      [kinds, limit],
    )
    await c.query('COMMIT')
    return r.rows
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    c.release()
  }
}

export async function completeOutbox(pool: Pick<Pool, 'query'>, id: string): Promise<void> {
  await pool.query(`UPDATE commercial_outbox SET status='done', processed_at=now() WHERE id=$1`, [id])
}

export async function failOutbox(pool: Pick<Pool, 'query'>, id: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE commercial_outbox SET status='failed', processed_at=now(), payload = payload || jsonb_build_object('error', $2::text) WHERE id=$1`,
    [id, error],
  )
}
