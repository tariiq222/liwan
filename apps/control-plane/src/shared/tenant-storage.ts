import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { z } from 'zod'
import { actorLabel } from '../admin-auth/grants.js'
import { transaction } from '../db.js'
import type { RegistryActor } from './registry-store.js'
import { TENANT_STORAGE_ERROR_CODES } from './tenant-storage-runner.js'

/**
 * Each SaaS tenant gets its own object-storage bucket, key and `fs.storage` record through tools/shared_saas_lifecycle/tenant_storage_effect.py.
 * One row of `tenant_storage` per tenant drives it; the effect itself keeps no state and is safe to repeat, so a lost run is only run again.
 * A run answers `pending_key` while the new key cannot work yet (about 7 minutes) and the next run is scheduled for then; nothing waits.
 * The product (odoo-addons, apps/web) knows nothing of this, and a tenant outside SaaS never gets a row (R5, R8).
 */
export type StorageOperation = 'ensure' | 'verify' | 'rotate'
export type StorageOutcome = { ok: true; response: StorageResponse } | { ok: false; code: string }

/** A claimed run outlasts the effect's timeout; a worker that died mid-run leaves a lease that simply expires. */
export const STORAGE_LEASE_SECONDS = 20 * 60
/** Failed runs since the last `active` before the row stops asking and waits for an operator. */
export const STORAGE_MAX_ATTEMPTS = 6
/** One tenant per pass: a run holds the shared job loop for as long as its containers take. */
export const STORAGE_RUNS_PER_PASS = 1
const MIN_RETRY_SECONDS = 30

export const storageResponseSchema = z.strictObject({
  operation: z.enum(['ensure', 'verify', 'rotate']), tenantId: z.string(), requestId: z.uuid(),
  state: z.enum(['pending_key', 'active']), stage: z.enum(['key_stored', 'verified']),
  retryAfterSeconds: z.number().int().min(1).max(3600).optional(),
}).refine(value => value.state === 'active' ? value.stage === 'verified' && value.retryAfterSeconds === undefined : value.stage !== 'verified' && value.retryAfterSeconds !== undefined)
export type StorageResponse = z.infer<typeof storageResponseSchema>

export type StorageClaim = { tenantId: string; operation: StorageOperation; requestId: string; revision: number; attempts: number }
export type StorageRunner = (input: { tenant_id: string; operation: StorageOperation; request_id: string; signal: AbortSignal }) => Promise<unknown>

/** 1 minute, doubling, at most an hour. */
export const storageBackoffSeconds = (attempts: number) => Math.min(3600, 60 * 2 ** Math.max(0, attempts - 1))

const READY = `FROM shared_registry_bindings b JOIN tenants t ON t.id=b.control_tenant_id
  WHERE b.enabled=true AND t.commercial_mode='saas' AND t.operations_enabled=true`

/** A tenant whose database is ready (its onboarding is active) and has no row yet gets one that asks for `ensure` at once. */
export async function discoverTenantStorage(pool: Pool): Promise<number> {
  const added = await pool.query(`INSERT INTO tenant_storage(control_tenant_id)
    SELECT b.control_tenant_id ${READY} AND EXISTS (SELECT 1 FROM shared_onboardings o WHERE o.control_tenant_id=b.control_tenant_id AND o.stage='active')
    ON CONFLICT (control_tenant_id) DO NOTHING`)
  return added.rowCount ?? 0
}

/** Takes the due rows (a lease, a fresh run id) so that no other worker runs the same tenant; only enabled SaaS tenants are ever due. */
export async function claimTenantStorage(pool: Pool, limit = STORAGE_RUNS_PER_PASS): Promise<StorageClaim[]> {
  const claimed = await pool.query(`WITH due AS (
      SELECT s.control_tenant_id FROM tenant_storage s
      JOIN shared_registry_bindings b ON b.control_tenant_id=s.control_tenant_id AND b.enabled=true
      JOIN tenants t ON t.id=s.control_tenant_id AND t.commercial_mode='saas' AND t.operations_enabled=true
      WHERE s.next_run_at<=clock_timestamp() ORDER BY s.next_run_at,s.control_tenant_id LIMIT $1 FOR UPDATE OF s SKIP LOCKED)
    UPDATE tenant_storage s SET request_id=gen_random_uuid(),next_run_at=clock_timestamp()+make_interval(secs=>$2),updated_at=clock_timestamp()
    FROM due WHERE s.control_tenant_id=due.control_tenant_id
    RETURNING s.control_tenant_id AS "tenantId",s.operation,s.request_id AS "requestId",s.revision,s.attempts`, [limit, STORAGE_LEASE_SECONDS])
  return claimed.rows
}

/**
 * Records one run, only while the row still belongs to it (same run id and revision): an operator request that came in meanwhile wins and its own
 * run follows. A rotation keeps asking for `rotate` until it is active; everything else asks for `verify` while pending and for `ensure` after a failure.
 */
export async function recordTenantStorageRun(pool: Pool, claim: StorageClaim, outcome: StorageOutcome): Promise<boolean> {
  const where = 'WHERE control_tenant_id=$1 AND request_id=$2 AND revision=$3'
  const identity = [claim.tenantId, claim.requestId, claim.revision]
  const rotating = claim.operation === 'rotate'
  let result
  if (outcome.ok && outcome.response.state === 'active') {
    result = await pool.query(`UPDATE tenant_storage SET operation='ensure',state='active',stage='verified',error_code=NULL,attempts=0,next_run_at=NULL,response=$4,updated_at=clock_timestamp() ${where}`,
      [...identity, outcome.response])
  } else if (outcome.ok) {
    // `attempts` counts failed runs since the last `active`: a pending answer does not clear it, so a key that never starts to work (a rotation that
    // issues a new candidate every time) still stops after STORAGE_MAX_ATTEMPTS.
    const wait = Math.max(MIN_RETRY_SECONDS, outcome.response.retryAfterSeconds ?? MIN_RETRY_SECONDS)
    result = await pool.query(`UPDATE tenant_storage SET operation=$4,state='pending_key',stage=$5,error_code=NULL,next_run_at=clock_timestamp()+make_interval(secs=>$6),response=$7,updated_at=clock_timestamp() ${where}`,
      [...identity, rotating ? 'rotate' : 'verify', outcome.response.stage, wait, outcome.response])
  } else {
    const attempts = claim.attempts + 1
    const stopped = attempts >= STORAGE_MAX_ATTEMPTS
    const code = TENANT_STORAGE_ERROR_CODES.has(outcome.code) ? outcome.code : 'script_failed'
    const next = stopped ? 'NULL' : 'clock_timestamp()+make_interval(secs=>$8)'
    result = await pool.query(`UPDATE tenant_storage SET operation=$4,state='failed',error_code=$5,attempts=$6,response=$7,next_run_at=${next},updated_at=clock_timestamp() ${where}`,
      [...identity, rotating ? 'rotate' : 'ensure', code, attempts, { error_code: code }, ...(stopped ? [] : [storageBackoffSeconds(attempts)])])
  }
  return (result.rowCount ?? 0) === 1
}

/** Discovers new tenants, then runs what is due. A run that fails is recorded and retried; the pass itself does not fail for it. */
export async function runTenantStorageDue(pool: Pool, runner: StorageRunner, opts: { signal: AbortSignal; limit?: number }): Promise<{ ran: number; recorded: number }> {
  await discoverTenantStorage(pool)
  let ran = 0, recorded = 0
  for (const claim of await claimTenantStorage(pool, opts.limit)) {
    if (opts.signal.aborted) break
    ran++
    let outcome: StorageOutcome
    try {
      const response = storageResponseSchema.parse(await runner({ tenant_id: claim.tenantId, operation: claim.operation, request_id: claim.requestId, signal: opts.signal }))
      if (response.requestId !== claim.requestId || response.operation !== claim.operation) throw Error('script_failed')
      outcome = { ok: true, response }
    } catch (error) {
      // A stopping worker leaves the lease to expire: the effect is safe to run again, and a half-seen result is not recorded.
      if (opts.signal.aborted) break
      outcome = { ok: false, code: error instanceof Error && TENANT_STORAGE_ERROR_CODES.has(error.message) ? error.message : 'script_failed' }
    }
    if (await recordTenantStorageRun(pool, claim, outcome)) recorded++
  }
  return { ran, recorded }
}

/**
 * An operator asks for a key rotation, or for a stopped or failed tenant to be tried again (`ensure`). Only a tenant that is enabled, SaaS and
 * has a ready database can be asked. `ensure` creates the row when the tenant has none; `rotate` needs a key that was stored at least once
 * (`tenant_storage_not_ready` otherwise). A run in flight is superseded. The request and its reason
 * are written to `audit_events` in the same transaction.
 */
export async function requestTenantStorage(pool: Pool, controlTenantId: string, operation: 'ensure' | 'rotate', actor: RegistryActor, reason: string): Promise<void> {
  z.uuid().parse(controlTenantId); z.string().trim().min(3).max(1000).parse(reason)
  const ready = `${READY} AND b.control_tenant_id=$1 AND EXISTS (SELECT 1 FROM shared_onboardings o WHERE o.control_tenant_id=b.control_tenant_id AND o.stage='active')`
  const reset = `operation=$2,state=CASE WHEN tenant_storage.state='failed' THEN 'queued' ELSE tenant_storage.state END,
    error_code=CASE WHEN tenant_storage.state='failed' THEN NULL ELSE tenant_storage.error_code END,attempts=0,next_run_at=clock_timestamp(),
    request_id=NULL,revision=tenant_storage.revision+1,updated_at=clock_timestamp()`
  await transaction(pool, async client => {
    if (operation === 'rotate') {
      // A rotation replaces a key that exists: a tenant that never stored one needs `ensure` first.
      if (!(await client.query(`SELECT 1 ${ready}`, [controlTenantId])).rowCount) throw Error('tenant_operations_unavailable')
      const rotated = await client.query(`UPDATE tenant_storage SET ${reset} WHERE control_tenant_id=$1 AND stage IS NOT NULL`, [controlTenantId, operation])
      if (rotated.rowCount !== 1) throw Error('tenant_storage_not_ready')
    } else {
      const asked = await client.query(`INSERT INTO tenant_storage(control_tenant_id,operation) SELECT b.control_tenant_id,$2 ${ready} ON CONFLICT (control_tenant_id) DO UPDATE SET ${reset}`, [controlTenantId, operation])
      if (asked.rowCount !== 1) throw Error('tenant_operations_unavailable')
    }
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), actorLabel(actor), 'tenant_storage.requested', controlTenantId, `${operation}: ${reason}`])
  })
}

/**
 * The storage loop of the shared worker. It runs beside the job loop, never inside it: a run (several container starts, up to ten minutes)
 * must not hold back backups, restores or reconfigurations. One pass at a time; it waits `idleMs` when nothing was due and `busyMs` after a run.
 */
export async function runTenantStorageLoop(pool: Pool, runner: StorageRunner, opts: { signal: AbortSignal; idleMs?: number; busyMs?: number; wait?: (ms: number) => Promise<void>; log?: (message: string, error?: unknown) => void }): Promise<void> {
  const wait = opts.wait ?? ((ms: number) => new Promise<void>(resolve => {
    if (opts.signal.aborted) { resolve(); return }
    const done = () => { clearTimeout(timer); opts.signal.removeEventListener('abort', done); resolve() }
    const timer = setTimeout(done, ms)
    opts.signal.addEventListener('abort', done, { once: true })
  }))
  while (!opts.signal.aborted) {
    let ran = 0
    try { ran = (await runTenantStorageDue(pool, runner, { signal: opts.signal })).ran }
    catch (error) { opts.log?.('tenant-storage pass failed', error) }
    await wait(ran > 0 ? opts.busyMs ?? 1_000 : opts.idleMs ?? 30_000)
  }
}

/** What an operator may read of a tenant's storage: the state, stage, last error and when the next run is due. Never a key, a secret or a resource name. */
export async function readTenantStorage(pool: Pool, controlTenantId: string) {
  z.uuid().parse(controlTenantId)
  const row = await pool.query(`SELECT operation,state,stage,error_code AS "errorCode",attempts,next_run_at AS "nextRunAt",updated_at AS "updatedAt"
    FROM tenant_storage WHERE control_tenant_id=$1`, [controlTenantId])
  return row.rows[0] ?? null
}
