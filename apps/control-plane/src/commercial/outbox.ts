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
export async function claimOutbox(pool: Pool, kinds: string[], limit: number, filter?: { automatic: true }): Promise<OutboxRow[]> {
  const r = await pool.query(
    `WITH due AS (
       SELECT id FROM commercial_outbox WHERE status='pending' AND kind = ANY($1::text[]) AND next_attempt_at <= now()
       AND (NOT $3::boolean OR payload->>'automatic'='true')
       ORDER BY created_at, id LIMIT $2 FOR UPDATE SKIP LOCKED)
     UPDATE commercial_outbox o SET next_attempt_at = now() + interval '5 minutes' FROM due WHERE o.id = due.id RETURNING o.*`,
    [kinds, limit, filter?.automatic ?? false],
  )
  return r.rows.sort((a: OutboxRow, b: OutboxRow) => a.created_at.getTime() - b.created_at.getTime() || a.id.localeCompare(b.id))
}

/**
 * Takes a five minute lease on one pending row, for a sender that delivers outside a worker loop. Exactly one caller wins
 * a due row, so a row two workers both found is sent once; a lease that expires (a sender that died) makes it due again.
 * The returned database timestamp preserves lease identity for a stopped sender to release only its own lease.
 */
export async function leaseOutboxRow(pool: Pick<Pool, 'query'>, id: string): Promise<string | null> {
  const r = await pool.query<{ lease_until: string }>(
    "UPDATE commercial_outbox SET next_attempt_at = now() + interval '5 minutes' WHERE id=$1 AND status='pending' AND next_attempt_at <= now() RETURNING next_attempt_at::text AS lease_until", [id])
  return r.rows[0]?.lease_until ?? null
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
export async function releaseOutbox(pool: Pick<Pool, 'query'>, id: string, leaseUntil?: string): Promise<void> {
  const condition = leaseUntil ? ' AND next_attempt_at=$2::timestamptz' : ''
  await pool.query(`UPDATE commercial_outbox SET next_attempt_at = now() WHERE id=$1 AND status='pending'${condition}`,
    leaseUntil ? [id, leaseUntil] : [id])
}
