import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { z } from 'zod'
import { isTransientDatabaseError, transaction } from '../db.js'
import { actorLabel } from '../admin-auth/grants.js'
import { requireJobAuthority } from './job-store.js'
import { recoverSharedJob, type SharedFencedAdapter } from './job-worker.js'
import type { RegistryActor } from './registry-store.js'

/**
 * The one list of operations whose stuck job this recovery can reconcile: the ones `recoverSharedJob` validates through
 * `bindJob`. A `reconfigure` job has its own receipt protocol (`subscription-reconfigure.ts`, resumed on every scheduler
 * tick by `recoverInterrupted`), which can write to Odoo, so it is not reconciled by observation here.
 */
export const RECOVERABLE_OPERATIONS = ['provision', 'backup', 'restore'] as const
export const isRecoverableOperation = (operation: unknown): operation is typeof RECOVERABLE_OPERATIONS[number] =>
  typeof operation === 'string' && (RECOVERABLE_OPERATIONS as readonly string[]).includes(operation)

/** 409 `shared_job_not_recoverable` naming the operation this recovery does not handle. */
export class UnsupportedRecoveryOperation extends Error {
  readonly detail: string
  constructor(operation: unknown) {
    super('shared_job_not_recoverable')
    this.detail = `Recovery does not support the '${typeof operation === 'string' ? operation : 'unknown'}' operation`
  }
}

/** Recovery requests the worker handles per pass; the rest wait for the next one. */
const RECOVERY_BATCH = 5

/**
 * Operator action: ask for a shared job in `needs_intervention` to be reconciled by observation (never re-executed).
 * Authority and the job's state are checked here, so a job that cannot be recovered answers `shared_job_not_recoverable`
 * at once. The observation itself needs the worker's Odoo adapter, so this only records the request for
 * `processJobRecoveries`. Asking again while a request is pending replays it.
 */
export async function requestSharedJobRecovery(pool: Pool, controlTenantId: string, jobId: string, actor: RegistryActor, reason: string) {
  z.uuid().parse(controlTenantId); z.uuid().parse(jobId); z.string().trim().min(3).max(1000).parse(reason)
  return transaction(pool, async client => {
    await requireJobAuthority(client, controlTenantId, actor)
    const job = await client.query("SELECT state,payload->>'operation' AS operation FROM shared_jobs WHERE id=$1 AND control_tenant_id=$2 FOR UPDATE", [jobId, controlTenantId])
    if (job.rows[0]?.state !== 'needs_intervention') throw new Error('shared_job_not_recoverable')
    if (!isRecoverableOperation(job.rows[0].operation)) throw new UnsupportedRecoveryOperation(job.rows[0].operation)
    const pending = await client.query("SELECT 1 FROM shared_job_recoveries WHERE job_id=$1 AND state='pending'", [jobId])
    if (pending.rowCount) return { job_id: jobId, state: 'pending' as const, replay: true }
    await client.query(`INSERT INTO shared_job_recoveries(job_id,issuer,actor_uid,reason) VALUES($1,$2,$3,$4)
      ON CONFLICT (job_id) DO UPDATE SET issuer=$2,actor_uid=$3,reason=$4,state='pending',error=NULL,requested_at=clock_timestamp(),completed_at=NULL`,
    [jobId, actor.issuer, actor.actorUid, reason.trim()])
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason) VALUES($1,$2,$3,$4,$5)', [randomUUID(), actorLabel(actor), 'shared_job.recovery_requested', jobId, reason.trim()])
    return { job_id: jobId, state: 'pending' as const, replay: false }
  })
}

type Request = { job_id: string; issuer: string; actor_uid: string | number; reason: string; requested_at: Date }

/**
 * Stores a request's outcome and its audit event together. Only the transaction that moves the request out of
 * `pending` writes the audit event, so a replayed pass can never add a second one.
 */
async function recordOutcome(client: PoolClient, jobId: string, state: 'verified' | 'still_needs_intervention' | 'failed', error: string | null) {
  const done = await client.query("UPDATE shared_job_recoveries SET state=$2,error=$3,completed_at=clock_timestamp() WHERE job_id=$1 AND state='pending' RETURNING job_id", [jobId, state, error])
  if (!done.rowCount) return
  await client.query('INSERT INTO audit_events(id,actor,action,subject,reason) VALUES($1,$2,$3,$4,$5)', [randomUUID(), 'shared-worker', 'shared_job.recovery_completed', jobId, error ? `${state}: ${error}` : state])
}

/**
 * True when the job is already `verified` by a recovery made by this request's operator after the request was made:
 * `recoverSharedJob` stamps `recoveredBy` on the job's verified event. A worker that stopped between verifying the job
 * and recording the outcome leaves exactly this behind, and the request is then done, not failed. A job verified any
 * other way (by someone else, before the request) does not match.
 */
async function recoveredByThisRequest(pool: Pool, request: Request) {
  const found = await pool.query(`SELECT 1 FROM shared_jobs j JOIN shared_job_events e ON e.job_id=j.id AND e.stage='verified'
    WHERE j.id=$1 AND j.state='verified' AND e.evidence->'recoveredBy'->>'issuer'=$2 AND e.evidence->'recoveredBy'->>'actorUid'=$3::text
    AND e.created_at>=$4 LIMIT 1`, [request.job_id, request.issuer, String(Number(request.actor_uid)), request.requested_at])
  return Boolean(found.rowCount)
}

/**
 * The shared worker's side: runs every pending recovery request through `recoverSharedJob` with the worker's adapter.
 * The outcome is stored on the request and in the audit trail, never swallowed: an effect the observation cannot
 * confirm leaves the job in `needs_intervention` (`still_needs_intervention`), and a request that cannot run
 * (authority lost, job already resolved) is `failed` with its error. A verification and its request's outcome are one
 * transaction. A transient database error or a stopping worker leaves the request pending for the next pass.
 */
export async function processJobRecoveries(pool: Pool, adapter: SharedFencedAdapter, input: { log?: (message: string, error?: unknown) => void } = {}): Promise<number> {
  const due = (await pool.query(`SELECT r.job_id,r.issuer,r.actor_uid,r.reason,r.requested_at,j.payload->>'operation' AS operation FROM shared_job_recoveries r
    JOIN shared_jobs j ON j.id=r.job_id WHERE r.state='pending' ORDER BY r.requested_at,r.job_id LIMIT $1`, [RECOVERY_BATCH])).rows
  for (const row of due) {
    const actor = { issuer: row.issuer as string, actorUid: Number(row.actor_uid) }
    let state: 'verified' | 'still_needs_intervention' | 'failed', error: string | null = null
    try {
      if (!isRecoverableOperation(row.operation)) throw new Error(`operation_unsupported:${row.operation ?? 'unknown'}`)
      if (await recoveredByThisRequest(pool, row)) state = 'verified'
      else {
        const result = await recoverSharedJob(pool, row.job_id, actor, row.reason, adapter, client => recordOutcome(client, row.job_id, 'verified', null))
        state = result.state === 'verified' ? 'verified' : 'still_needs_intervention'
      }
    } catch (e) {
      if (isTransientDatabaseError(e) || (e instanceof Error && e.message === 'shared_worker_stopping')) throw e
      state = 'failed'
      error = (e instanceof Error ? e.message : 'recovery_failed').slice(0, 200)
      input.log?.(`shared job recovery ${row.job_id} failed`, e)
    }
    await transaction(pool, client => recordOutcome(client, row.job_id, state, error))
  }
  return due.length
}
