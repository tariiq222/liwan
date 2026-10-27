import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'

export type OutboxRow = {
  id: string; kind: string; aggregate_id: string; dedupe_key: string; payload: unknown
  status: 'pending' | 'done' | 'failed'; created_at: Date; processed_at: Date | null
  attempts: number; next_attempt_at: Date
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

/** Takes a five minute lease on due pending rows (creation order); the caller completes, defers, releases or fails them. */
export async function claimOutbox(pool: Pool, kinds: string[], limit: number): Promise<OutboxRow[]> {
  const r = await pool.query(
    `WITH due AS (
       SELECT id FROM commercial_outbox WHERE status='pending' AND kind = ANY($1::text[]) AND next_attempt_at <= now()
       ORDER BY created_at, id LIMIT $2 FOR UPDATE SKIP LOCKED)
     UPDATE commercial_outbox o SET next_attempt_at = now() + interval '5 minutes' FROM due WHERE o.id = due.id RETURNING o.*`,
    [kinds, limit],
  )
  return r.rows.sort((a: OutboxRow, b: OutboxRow) => a.created_at.getTime() - b.created_at.getTime() || a.id.localeCompare(b.id))
}

export async function completeOutbox(pool: Pick<Pool, 'query'>, id: string): Promise<void> {
  await pool.query(`UPDATE commercial_outbox SET status='done', processed_at=now() WHERE id=$1 AND status='pending'`, [id])
}

export async function failOutbox(pool: Pick<Pool, 'query'>, id: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE commercial_outbox SET status='failed', processed_at=now(), payload = payload || jsonb_build_object('error', $2::text) WHERE id=$1 AND status='pending'`,
    [id, error],
  )
}

/** Transient failure: counts the attempt and backs off 1, 2, 4 ... 60 minutes. */
export async function deferOutbox(pool: Pick<Pool, 'query'>, id: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE commercial_outbox SET attempts = attempts + 1, next_attempt_at = now() + LEAST(power(2, attempts), 60) * interval '1 minute',
       payload = payload || jsonb_build_object('error', $2::text) WHERE id=$1 AND status='pending'`,
    [id, error],
  )
}

/** A waiting row (nothing failed) gives its lease back so the next tick re-checks it. */
export async function releaseOutbox(pool: Pick<Pool, 'query'>, id: string): Promise<void> {
  await pool.query(`UPDATE commercial_outbox SET next_attempt_at = now() WHERE id=$1 AND status='pending'`, [id])
}
