import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { z } from 'zod'
import { ABANDONABLE_OPERATIONS } from '@liwan/commercial-contracts'
import { sharedObservationSchema } from '@liwan/commercial-contracts/shared'
import { isTransientDatabaseError, transaction } from '../db.js'
import { actorLabel } from '../admin-auth/grants.js'
import { requireJobAuthority } from './job-store.js'
import { bindJob } from './provisioning.js'
import type { SharedFencedAdapter } from './job-worker.js'
import type { RegistryActor } from './registry-store.js'

/**
 * The operations a stuck job may be abandoned for, each with the reason it is safe (issue 446, owner decision 2026-11-10).
 * Abandoning closes the job for good and nothing retries it, so it is allowed only where the next attempt is a new job:
 * - `backup`: with the effect absent no artifact exists and nothing refers to the job; a new backup is a new job.
 * - `restore`: every approval names its own fresh target database, so a new approval is a new job; the abandoned
 *   approval stays consumed and its target is never reused.
 * Refused: `provision` (the onboarding row and the customer's order point at that one job and no path starts a second
 * one, so closing it would strand them) and `reconfigure` (its own receipt protocol can write to Odoo and is resumed by
 * the scheduler, and its order fails through the commercial path).
 */
export { ABANDONABLE_OPERATIONS }
export const isAbandonableOperation = (operation: unknown): operation is typeof ABANDONABLE_OPERATIONS[number] =>
  typeof operation === 'string' && (ABANDONABLE_OPERATIONS as readonly string[]).includes(operation)

/** 409 `shared_job_not_abandonable` naming the operation that cannot be abandoned. */
export class UnsupportedAbandonOperation extends Error {
  readonly detail: string
  constructor(operation: unknown) {
    super('shared_job_not_abandonable')
    this.detail = `Abandoning does not support the '${typeof operation === 'string' ? operation : 'unknown'}' operation`
  }
}

const ABANDON_BATCH = 5

/**
 * Operator action: ask for a stuck shared job to be closed as failed. Authority and the job's state are checked here;
 * the effect check needs the worker's Odoo adapter, so this only records the request for `processJobAbandonments`.
 * Asking again while a request is pending replays it; a request that ended can be made again while the job still stands.
 */
export async function requestSharedJobAbandon(pool: Pool, controlTenantId: string, jobId: string, actor: RegistryActor, reason: string) {
  z.uuid().parse(controlTenantId); z.uuid().parse(jobId); z.string().trim().min(3).max(1000).parse(reason)
  return transaction(pool, async client => {
    await requireJobAuthority(client, controlTenantId, actor)
    const job = await client.query("SELECT state,payload->>'operation' AS operation FROM shared_jobs WHERE id=$1 AND control_tenant_id=$2 FOR UPDATE", [jobId, controlTenantId])
    if (job.rows[0]?.state !== 'needs_intervention') throw new Error('shared_job_not_abandonable')
    if (!isAbandonableOperation(job.rows[0].operation)) throw new UnsupportedAbandonOperation(job.rows[0].operation)
    const pending = await client.query("SELECT 1 FROM shared_job_abandonments WHERE job_id=$1 AND state='pending'", [jobId])
    if (pending.rowCount) return { job_id: jobId, state: 'pending' as const, replay: true }
    await client.query(`INSERT INTO shared_job_abandonments(job_id,issuer,actor_uid,reason) VALUES($1,$2,$3,$4)
      ON CONFLICT (job_id) DO UPDATE SET issuer=$2,actor_uid=$3,reason=$4,state='pending',error=NULL,requested_at=clock_timestamp(),completed_at=NULL`,
    [jobId, actor.issuer, actor.actorUid, reason.trim()])
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason) VALUES($1,$2,$3,$4,$5)', [randomUUID(), actorLabel(actor), 'shared_job.abandon_requested', jobId, reason.trim()])
    return { job_id: jobId, state: 'pending' as const, replay: false }
  })
}

type Outcome = { state: 'abandoned' | 'effect_present' }

/**
 * The worker's side of one request. The effect is observed outside any transaction; the job is then locked again and
 * must be exactly as it was observed (same attempt, same fence, still needs_intervention) before it is closed, so a
 * job that moved meanwhile is never abandoned on a stale observation. Only an `absent` observation closes the job:
 * `present` means the effect exists (recover is the right action), and `partial` or `unknown` is not proof of absence.
 */
async function abandonOne(pool: Pool, jobId: string, actor: RegistryActor, adapter: SharedFencedAdapter): Promise<Outcome> {
  const inspect = async (client: import('pg').PoolClient) => {
    const result = await client.query("SELECT * FROM shared_jobs WHERE id=$1 AND state='needs_intervention' FOR UPDATE", [jobId])
    if (!result.rowCount) throw new Error('shared_job_not_abandonable')
    const row = result.rows[0]
    await requireJobAuthority(client, row.control_tenant_id, actor)
    if (!isAbandonableOperation(row.payload?.operation)) throw new UnsupportedAbandonOperation(row.payload?.operation)
    return { row, job: bindJob(row.payload) }
  }
  const before = await transaction(pool, inspect)
  const observation = sharedObservationSchema.parse(await adapter.observe(before.job))
  if (observation.state === 'present') return { state: 'effect_present' }
  if (observation.state !== 'absent') throw new Error(`effect_not_proven_absent:${observation.state}`)
  return transaction(pool, async client => {
    const { row } = await inspect(client)
    if (row.attempt_id !== before.row.attempt_id || Number(row.fence) !== Number(before.row.fence)) throw new Error('shared_lease_lost')
    const closed = await client.query("UPDATE shared_jobs SET state='failed',lease_until=NULL WHERE id=$1 AND fence=$2 AND state='needs_intervention' RETURNING id", [jobId, row.fence])
    if (!closed.rowCount) throw new Error('shared_lease_lost')
    return { state: 'abandoned' }
  })
}

/**
 * Runs every pending abandon request with the worker's adapter. The outcome is stored on the request and in the audit
 * trail, never swallowed. A transient database error or a stopping worker leaves the request pending for the next pass.
 */
export async function processJobAbandonments(pool: Pool, adapter: SharedFencedAdapter, input: { log?: (message: string, error?: unknown) => void } = {}): Promise<number> {
  const due = (await pool.query(`SELECT job_id,issuer,actor_uid,reason FROM shared_job_abandonments WHERE state='pending'
    ORDER BY requested_at,job_id LIMIT $1`, [ABANDON_BATCH])).rows
  for (const row of due) {
    const actor = { issuer: row.issuer as string, actorUid: Number(row.actor_uid) }
    let state: 'abandoned' | 'effect_present' | 'failed', error: string | null = null
    try {
      state = (await abandonOne(pool, row.job_id, actor, adapter)).state
    } catch (e) {
      if (isTransientDatabaseError(e) || (e instanceof Error && e.message === 'shared_worker_stopping')) throw e
      state = 'failed'
      error = (e instanceof Error ? e.message : 'abandon_failed').slice(0, 200)
      input.log?.(`shared job abandon ${row.job_id} failed`, e)
    }
    await transaction(pool, async client => {
      await client.query("UPDATE shared_job_abandonments SET state=$2,error=$3,completed_at=clock_timestamp() WHERE job_id=$1 AND state='pending'", [row.job_id, state, error])
      const detail = error ? `${state}: ${error}` : state
      await client.query('INSERT INTO audit_events(id,actor,action,subject,reason) VALUES($1,$2,$3,$4,$5)', [randomUUID(), 'shared-worker', state === 'abandoned' ? 'shared_job.abandoned' : 'shared_job.abandon_refused', row.job_id, `${detail}; requested: ${row.reason}`.slice(0, 1000)])
    })
  }
  return due.length
}
