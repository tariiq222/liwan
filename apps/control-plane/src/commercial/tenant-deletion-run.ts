import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { TENANT_DELETION_HOLD_HOURS, TENANT_DELETION_LAST_CALL_HOURS, type TenantDeletionStepName } from '@liwan/commercial-contracts'
import type { Config } from '../config.js'
import { transaction } from '../db.js'
import { publishRegistryMutation } from '../shared/registry-store.js'
import { tenantDeletionActor, type DeletionAuthorityMode } from '../shared/tenant-deletion-authority.js'
import { lockTenantJobs } from '../shared/job-store.js'
import { enqueueOutbox } from './outbox.js'
import { isLocalCapture } from './mail-adapter.js'
import type { PaymentAdapter } from './payment-adapter.js'
import { removePaymentMethod } from './payment-method-removal.js'
import { audited, DELETION_SYSTEM_ACTOR, lockCustomerDeletion, TENANT_DELETION_NOTICE_KIND, type DeletionNoticePayload } from './tenant-deletion.js'
import type { AssertOwned, DeletionEffects, DropStage } from './tenant-deletion-effects.js'
import { buildDeletionPlan, deletionPrechecks, IMMEDIATE_ALERT_CHECKS, noticeKey, noticeKeySql, planDigestOf, type DeletionPlan, type EffectPlan } from './tenant-deletion-plan.js'
import { TOKEN_DELETE_KIND } from './form-payments.js'

/** A runner owns one request for this long, renewed at every permit and heartbeat; a crashed runner's lease runs out and another takes over with a higher fence. */
export const DELETION_LEASE_SECONDS = 120
/** A failed step waits this long after its first, second, third, fourth and later failure. */
export const DELETION_BACKOFF_MINUTES = [1, 5, 30, 120, 360] as const
/** A deferral (a check that is not met yet) is looked at again after this long. */
export const DELETION_DEFER_MINUTES = 15
export const DELETION_STUCK_FAILURES = 5
export const DELETION_STUCK_HOURS = 24
/** A saved card the provider will not delete is retried this many times or this long, then the deletion goes on and the vendor is alerted. */
export const CARD_DELETE_MAX_TRIES = 12
/** The final mail has this long to be sent before the contacts are anonymised anyway (with an alert). */
export const FINAL_MAIL_DAYS = 7
/** A last call is not sent for a hold with less than this left; the preflight then extends the hold so the notice is delivered its full 24 hours before. */
export const LAST_CALL_MIN_REMAINING_HOURS = 2
const OFFSITE_SETTLE_SECONDS = 60
const KILL_SWITCH_OFF = 'kill_switch_off'
const DRY_RUN_EVERY_HOURS = 1
/** Keys of a closed outbox payload or an audit record that name a recipient, a person or a secret code. */
const PERSONAL_KEYS = ['to', 'email', 'recipient', 'admin_login', 'admin_name', 'login', 'mobile', 'phone', 'code', 'token', 'client_address', 'address_hash', 'error']

/** The kill switch: nothing destructive runs unless this is exactly `true`. */
export type TenantDeletionDisabledReason = 'kill_switch_off' | 'mail_host_unset' | 'local_mail_capture'
/**
 * Whether the runner may run destructively, and if not why. Besides the kill switch, the mail host must be a real one: a local capture host (localhost, mailpit)
 * accepts every mail, so "delivered" would prove nothing about the customer having been warned.
 */
export function tenantDeletionMode(env: Record<string, string | undefined>): { enabled: boolean; reason: TenantDeletionDisabledReason | null } {
  if (env.LIWAN_TENANT_DELETION_ENABLED !== 'true') return { enabled: false, reason: 'kill_switch_off' }
  const host = env.LIWAN_MAIL_SMTP_HOST?.trim()
  if (!host) return { enabled: false, reason: 'mail_host_unset' }
  if (isLocalCapture(host)) return { enabled: false, reason: 'local_mail_capture' }
  return { enabled: true, reason: null }
}

export type TenantDeletionDeps = {
  pool: Pool; config: Config; effects: DeletionEffects
  /** The kill switch (`LIWAN_TENANT_DELETION_ENABLED`): while false nothing destructive runs and only "would do" lines are recorded. */
  enabled: boolean
  registryPath: string
  paymentAdapter?: PaymentAdapter
  signal?: AbortSignal
  log?: (message: string, error?: unknown) => void
}
type Ctx = TenantDeletionDeps & { id: string; customerId: string; fence: number }
type Row = Record<string, any> & { id: string; customer_id: string; due_marked_at: Date }
type Outcome = { evidence?: Record<string, unknown>; keepAlert?: boolean } | { defer: string; alert?: boolean; evidence?: Record<string, unknown> } | { skip: string; evidence?: Record<string, unknown> }
type StepInfo = { attempts: number; failures: number; elapsedHours: number }

class LeaseLost extends Error { constructor() { super('deletion_lease_lost') } }
/** The request moved on (withdrawn, finished by another runner): the run stops quietly and records nothing. */
class StateChanged extends Error { constructor() { super('deletion_state_changed') } }

const STEP_STATES: Record<TenantDeletionStepName, string[]> = {
  preflight: ['due', 'deleting'], stop_access: ['deleting'], unbind_relay: ['deleting'], commit: ['deleting'], delete_cards: ['deleting'], drop_database: ['deleting'],
  remove_filestore: ['deleting'], remove_restore_copies: ['deleting'], purge_local_backups: ['deleting'], purge_offsite: ['deleting'], remove_side_files: ['deleting'],
  clean_registry_rows: ['deleting'], finish: ['deleting', 'deleted'], anonymise_contacts: ['deleted'], reinstate: ['withdrawn'],
}
const codeOf = (error: unknown) => error instanceof Error && /^[a-z0-9_]{1,64}$/.test(error.message) ? error.message : 'step_failed'
const planOf = (row: Row): DeletionPlan => row.plan as DeletionPlan

/**
 * Queues the last-call notice of every request in its hold, once per hold, `TENANT_DELETION_LAST_CALL_HOURS` before the hold ends. A hold with less than
 * LAST_CALL_MIN_REMAINING_HOURS left is not warned (a notice that late is no call at all): the preflight extends such a hold until the notice has been delivered its full time before.
 */
export async function queueLastCalls(pool: Pool): Promise<number> {
  const rows = (await pool.query(`SELECT id,hold_notice_seq FROM tenant_deletion_requests WHERE state='due' AND hold_until > now() + make_interval(hours => $2)
    AND hold_until - make_interval(hours => $1) <= now()`, [TENANT_DELETION_LAST_CALL_HOURS, LAST_CALL_MIN_REMAINING_HOURS])).rows as { id: string; hold_notice_seq: number }[]
  let queued = 0
  for (const { id, hold_notice_seq: seq } of rows) if (await enqueueOutbox(pool, { kind: TENANT_DELETION_NOTICE_KIND, aggregate_id: id, dedupe_key: noticeKey('last_call', id, seq), payload: { type: 'last_call', request_id: id, seq } satisfies DeletionNoticePayload })) queued++
  return queued
}

/** Takes the lease of one request in one of `states`: a higher fence and a lease; null when another runner holds it or the state does not match. */
async function claimLease(pool: Pool, id: string, states: string[]): Promise<{ customerId: string; fence: number } | null> {
  const ref = (await pool.query('SELECT customer_id FROM tenant_deletion_requests WHERE id=$1', [id])).rows[0]
  if (!ref) return null
  return transaction(pool, async client => {
    await lockCustomerDeletion(client, ref.customer_id)
    const claimed = (await client.query(`UPDATE tenant_deletion_requests SET fence=fence+1,lease_until=now() + make_interval(secs => $3) WHERE id=$1 AND state=ANY($2::text[])
      AND (lease_until IS NULL OR lease_until <= now()) RETURNING fence`, [id, states, DELETION_LEASE_SECONDS])).rows[0]
    return claimed ? { customerId: ref.customer_id as string, fence: Number(claimed.fence) } : null
  })
}

/**
 * One short transaction that owns the request: the customer deletion lock, the subscription row, then the tenant's job lock, in that order, then the request row.
 * It checks the lease and the fence, so a runner that lost either writes nothing. Effects never run inside it.
 */
async function withTx<T>(ctx: Ctx, action: (client: PoolClient, row: Row, tenantId: string | null) => Promise<T>): Promise<T> {
  return transaction(ctx.pool, async client => {
    await lockCustomerDeletion(client, ctx.customerId)
    const tenantId: string | null = (await client.query('SELECT tenant_id FROM customers WHERE id=$1', [ctx.customerId])).rows[0]?.tenant_id ?? null
    await client.query('SELECT id FROM subscriptions WHERE customer_id=$1 FOR UPDATE', [ctx.customerId])
    if (tenantId) await lockTenantJobs(client, tenantId)
    const row = (await client.query('SELECT *,(lease_until > now()) AS leased FROM tenant_deletion_requests WHERE id=$1 FOR UPDATE', [ctx.id])).rows[0]
    if (!row || Number(row.fence) !== ctx.fence || row.leased !== true) throw new LeaseLost()
    return action(client, row, tenantId)
  })
}

/**
 * The check an effect makes before its first change and on every heartbeat: the lease is renewed only while this runner still holds the fence and the request is
 * `deleting` with the plan digest that was frozen (and, after the point of no return, committed). Anything else stops the effect.
 */
function ownership(ctx: Ctx, digest: string, committed: boolean): AssertOwned {
  return async () => {
    const renewed = await ctx.pool.query(`UPDATE tenant_deletion_requests SET lease_until=now() + make_interval(secs => $4) WHERE id=$1 AND fence=$2 AND lease_until > now()
      AND state='deleting' AND plan_digest=$3 AND ($5::boolean IS FALSE OR committed_at IS NOT NULL)`, [ctx.id, ctx.fence, digest, DELETION_LEASE_SECONDS, committed])
    if (!renewed.rowCount) throw new LeaseLost()
  }
}

async function markStuck(client: PoolClient, row: Row, step: string, code: string) {
  const stuck = `${step}:${code}`
  if (row.stuck_code === stuck) return
  await client.query('UPDATE tenant_deletion_requests SET stuck_at=now(),stuck_code=$2 WHERE id=$1', [row.id, stuck])
  await audited(client, { actor: DELETION_SYSTEM_ACTOR, client_address: null }, 'tenant_deletion.stuck', row.customer_id, '', { request_id: row.id, step, code })
}

/**
 * Runs one step of the ledger: it is recorded `running` with its intent, the body observes and acts, and the step is recorded `done` with its evidence, so a crash
 * resumes at the step without repeating a finished one. A deferral is not a failure; a failure backs off and, after DELETION_STUCK_FAILURES in a row or
 * DELETION_STUCK_HOURS in one step, flags the request stuck for the vendor.
 */
async function runStep(ctx: Ctx, name: TenantDeletionStepName, intent: string, body: (info: StepInfo) => Promise<Outcome>): Promise<'done' | 'wait' | 'abort'> {
  const start = await withTx(ctx, async (client, row) => {
    if (!STEP_STATES[name].includes(row.state)) return { status: 'abort' as const }
    if (row.plan && planDigestOf(row.plan) !== row.plan_digest) { await markStuck(client, row, name, 'plan_digest_mismatch'); return { status: 'abort' as const } }
    const prev = (await client.query('SELECT *,(next_attempt_at > now()) AS waiting,extract(epoch FROM (now() - started_at)) / 3600 AS hours FROM tenant_deletion_steps WHERE request_id=$1 AND step=$2 FOR UPDATE', [ctx.id, name])).rows[0]
    if (prev && (prev.state === 'done' || (prev.state === 'skipped' && prev.error_code !== KILL_SWITCH_OFF))) return { status: 'done' as const }
    if (prev?.waiting) return { status: 'wait' as const }
    const fresh = !prev || prev.error_code === KILL_SWITCH_OFF
    const upserted = (await client.query(`INSERT INTO tenant_deletion_steps(request_id,step,state,intent,attempts,started_at) VALUES($1,$2,'running',$3,1,now())
      ON CONFLICT (request_id,step) DO UPDATE SET state='running',intent=$3,attempts=tenant_deletion_steps.attempts+1,finished_at=NULL,error_code=NULL,next_attempt_at=NULL,
        started_at=CASE WHEN $4::boolean THEN now() ELSE COALESCE(tenant_deletion_steps.started_at,now()) END,
        failures=CASE WHEN $4::boolean THEN 0 ELSE tenant_deletion_steps.failures END
      RETURNING attempts,failures`, [ctx.id, name, intent, fresh])).rows[0]
    return { status: 'run' as const, info: { attempts: upserted.attempts, failures: upserted.failures, elapsedHours: fresh ? 0 : Number(prev.hours ?? 0) } }
  })
  if (start.status !== 'run') return start.status
  let outcome: Outcome
  try { outcome = await body(start.info) }
  catch (error) {
    if (error instanceof LeaseLost) throw error
    if (error instanceof StateChanged) return 'abort'
    const code = codeOf(error)
    ctx.log?.(`tenant deletion step ${name} failed with ${code}`, error)
    await withTx(ctx, async (client, row) => {
      const failures = start.info.failures + 1
      await client.query(`UPDATE tenant_deletion_steps SET state='failed',failures=$3,error_code=$4,next_attempt_at=now() + make_interval(mins => $5) WHERE request_id=$1 AND step=$2`,
        [ctx.id, name, failures, code, DELETION_BACKOFF_MINUTES[Math.min(failures, DELETION_BACKOFF_MINUTES.length) - 1]])
      if (failures >= DELETION_STUCK_FAILURES || start.info.elapsedHours >= DELETION_STUCK_HOURS) await markStuck(client, row, name, code)
    })
    return 'wait'
  }
  return withTx(ctx, async (client, row) => {
    if ('defer' in outcome) {
      await client.query(`UPDATE tenant_deletion_steps SET state='pending',error_code=$3,next_attempt_at=now() + make_interval(mins => $4),evidence=$5::jsonb WHERE request_id=$1 AND step=$2`,
        [ctx.id, name, outcome.defer, DELETION_DEFER_MINUTES, JSON.stringify(outcome.evidence ?? {})])
      if (outcome.alert || IMMEDIATE_ALERT_CHECKS.includes(outcome.defer) || start.info.elapsedHours >= DELETION_STUCK_HOURS) await markStuck(client, row, name, outcome.defer)
      return 'wait' as const
    }
    const skipReason = 'skip' in outcome ? outcome.skip : null
    await client.query(`UPDATE tenant_deletion_steps SET state=$3,error_code=$4,finished_at=now(),next_attempt_at=NULL,evidence=$5::jsonb WHERE request_id=$1 AND step=$2`,
      [ctx.id, name, skipReason ? 'skipped' : 'done', skipReason, JSON.stringify(outcome.evidence ?? {})])
    if (!('keepAlert' in outcome && outcome.keepAlert)) await client.query(`UPDATE tenant_deletion_requests SET stuck_at=NULL,stuck_code=NULL WHERE id=$1 AND stuck_code LIKE $2`, [ctx.id, `${name}:%`])
    return 'done' as const
  })
}

const dueNotice = (type: DeletionNoticePayload['type'], id: string, seq = 1, reason?: 'restore') => ({ kind: TENANT_DELETION_NOTICE_KIND, aggregate_id: id, dedupe_key: noticeKey(type, id, seq), payload: { type, request_id: id, seq, ...(reason ? { reason } : {}) } satisfies DeletionNoticePayload })
const SYSTEM = { actor: DELETION_SYSTEM_ACTOR, client_address: null }
const DESTRUCTIVE_STAGES = ['drop_database', 'remove_filestore', 'remove_restore_copies', 'purge_local_backups', 'remove_side_files'] as const
const LEASE_CODES = ['deletion_lease_lost', 'deletion_worker_stopping']

/** The check an effect makes before its first change while the request is not yet `deleting` (the identity gate of the preflight): the lease and the fence only. */
function leaseOwned(ctx: Ctx, states: string[]): AssertOwned {
  return async () => {
    const renewed = await ctx.pool.query(`UPDATE tenant_deletion_requests SET lease_until=now() + make_interval(secs => $3) WHERE id=$1 AND fence=$2 AND lease_until > now() AND state=ANY($4::text[])`,
      [ctx.id, ctx.fence, DELETION_LEASE_SECONDS, states])
    if (!renewed.rowCount) throw new LeaseLost()
  }
}

type Gate = { defer: string; alert: true; evidence?: Record<string, unknown> } | { evidence: Record<string, unknown> }

/**
 * The gate that proves, before anything is stopped or committed, that the plan names this tenant's database and that every destructive stage would pass:
 * `verify` must answer `ok`, then a dry run of every destructive stage. Any refusal defers with its code and alerts the vendor; the request stays withdrawable.
 * `absent` is not acceptable here: a database already gone is expected only after the commit.
 *
 * A tenant with no marker is stamped only when it was created before the marker requirement (`control_plane_state.marker_required_since`, written by the migration that
 * introduced it) and only after a clean dry run of the stamp; the real stamp is audited with the database, the plan digest and the effect's own checks, and returned
 * as evidence for the step ledger. A newer tenant with no marker is a refusal for an operator, and nothing is written.
 */
async function verifyIdentity(ctx: Ctx, effect: EffectPlan, assertOwned: AssertOwned): Promise<Gate> {
  const digest = planDigestOf(effect)
  const call = (stage: DropStage, dryRun: boolean) => ctx.effects.stage({ stage, plan: effect, planDigest: digest, dryRun, assertOwned })
  const evidence: Record<string, unknown> = {}
  try {
    let verdict = await call('verify', true)
    if (verdict.verdict === 'refused' && verdict.code === 'identity_marker_missing') {
      const eligible = (await ctx.pool.query('SELECT t.created_at < s.marker_required_since AS old FROM tenants t, control_plane_state s WHERE t.id=$1', [effect.controlTenantId])).rows[0]?.old === true
      if (!eligible) return { defer: 'marker_missing_needs_operator', alert: true, evidence: { verdict: 'refused', code: 'identity_marker_missing' } }
      await call('stamp_marker', true)
      const stamped = await call('stamp_marker', false)
      await transaction(ctx.pool, client => audited(client, SYSTEM, 'tenant_deletion.marker_stamped', ctx.customerId, '', { request_id: ctx.id, database: effect.database, plan_digest: digest, state: stamped.state ?? null, checks: stamped.checks ?? null }))
      evidence.stamped = { state: stamped.state ?? null, checks: stamped.checks ?? null }
      verdict = await call('verify', true)
    }
    if (verdict.verdict !== 'ok') return { defer: verdict.verdict === 'absent' ? 'database_absent' : codeOf(Error(String(verdict.code))), alert: true, evidence: { verdict: verdict.verdict, checks: verdict.checks ?? null } }
    for (const stage of DESTRUCTIVE_STAGES) await call(stage, true)
  } catch (error) {
    if (error instanceof LeaseLost || (error instanceof Error && LEASE_CODES.includes(error.message))) throw new LeaseLost()
    return { defer: codeOf(error), alert: true }
  }
  return { evidence }
}

/** Whether the customer has had the time: the due notice of this hold delivered at least the full hold ago and its last call at least 24 hours ago (both really delivered, never closed as stale). */
async function noticeService(client: Pick<PoolClient, 'query'>, id: string): Promise<{ due: boolean; last_call: boolean; needed_at: Date | null; served: boolean }> {
  const row = (await client.query(`SELECT d.id IS NOT NULL AS due, l.id IS NOT NULL AS last_call,
      GREATEST(d.processed_at + make_interval(hours => $2), l.processed_at + make_interval(hours => $3)) AS needed_at
    FROM tenant_deletion_requests r
    LEFT JOIN commercial_outbox d ON d.kind=$4 AND d.aggregate_id=r.id::text AND d.dedupe_key=${noticeKeySql('due', 'r')} AND d.status='done' AND d.payload->>'delivered'='true'
    LEFT JOIN commercial_outbox l ON l.kind=$4 AND l.aggregate_id=r.id::text AND l.dedupe_key=${noticeKeySql('last_call', 'r')} AND l.status='done' AND l.payload->>'delivered'='true'
    WHERE r.id=$1`, [id, TENANT_DELETION_HOLD_HOURS, TENANT_DELETION_LAST_CALL_HOURS, TENANT_DELETION_NOTICE_KIND])).rows[0]
  const neededAt: Date | null = row.needed_at
  const now = (await client.query('SELECT now() AS now')).rows[0].now as Date
  return { due: row.due, last_call: row.last_call, needed_at: neededAt, served: row.due && row.last_call && neededAt !== null && neededAt <= now }
}

/**
 * S1: still due and withdrawable, every precondition met, the identity proven and every destructive stage dry-run, the notices served; then the plan is frozen and the
 * request becomes `deleting`. Deferring, never failing. A notice that arrived late extends the hold to its full length and tells the customer the new time.
 */
async function preflight(ctx: Ctx): Promise<Outcome> {
  const peek = await currentRow(ctx)
  if (peek.state === 'deleting') return { evidence: { resumed: true, plan_digest: peek.plan_digest } }
  if (peek.state !== 'due' || peek.withdrawn_at) throw new StateChanged()
  const tenantId: string | null = (await ctx.pool.query('SELECT tenant_id FROM customers WHERE id=$1', [ctx.customerId])).rows[0]?.tenant_id ?? null
  // The cheap database checks first: nothing is asked of the effects while a payment, a job or a notice still defers the request.
  const early = await deletionPrechecks(ctx.pool, peek, tenantId)
  if (early.blocked_by) return { defer: early.blocked_by, evidence: { checks: early.checks } }
  let candidate: DeletionPlan
  try { candidate = await buildDeletionPlan(ctx.pool, peek) } catch { return { defer: 'binding_found' } }
  const gate = await verifyIdentity(ctx, candidate.effect, leaseOwned(ctx, ['due']))
  if ('defer' in gate) return gate
  return withTx(ctx, async (client, row, tenantId) => {
    if (row.state === 'deleting') return { evidence: { resumed: true, plan_digest: row.plan_digest } }
    if (row.state !== 'due' || row.withdrawn_at) throw new StateChanged()
    const pre = await deletionPrechecks(client, row, tenantId)
    if (pre.blocked_by) return { defer: pre.blocked_by, evidence: { checks: pre.checks } }
    const service = await noticeService(client, ctx.id)
    if (!service.last_call) {
      // No delivered last call yet: make sure one is queued for this hold; it is judged when it has gone out.
      await enqueueOutbox(client, dueNotice('last_call', ctx.id, row.hold_notice_seq))
      return { defer: 'last_call_delivered' }
    }
    if (!service.served) {
      const extended = (await client.query(`UPDATE tenant_deletion_requests SET hold_until=GREATEST(hold_until,$2),revision=revision+1 WHERE id=$1 AND hold_until < $2 RETURNING hold_until`, [ctx.id, service.needed_at])).rows[0]
      if (extended) {
        await enqueueOutbox(client, { kind: TENANT_DELETION_NOTICE_KIND, aggregate_id: ctx.id, dedupe_key: `hold_extended:${ctx.id}:${Math.floor(extended.hold_until.getTime() / 1000)}`, payload: { type: 'hold_extended', request_id: ctx.id } satisfies DeletionNoticePayload })
        await audited(client, SYSTEM, 'tenant_deletion.hold_extended', row.customer_id, '', { request_id: ctx.id, hold_until: extended.hold_until.toISOString() })
      }
      return { defer: 'hold_not_served' }
    }
    const plan = await buildDeletionPlan(client, row)
    if (planDigestOf(plan.effect) !== planDigestOf(candidate.effect)) return { defer: 'plan_changed' }
    const digest = planDigestOf(plan)
    await client.query("UPDATE tenant_deletion_requests SET state='deleting',deleting_at=now(),plan=$2::jsonb,plan_digest=$3,stuck_at=NULL,stuck_code=NULL,revision=revision+1 WHERE id=$1", [ctx.id, JSON.stringify(plan), digest])
    await audited(client, SYSTEM, 'tenant_deletion.deleting', row.customer_id, '', { request_id: ctx.id, plan_digest: digest })
    await enqueueOutbox(client, dueNotice('deleting', ctx.id))
    return { evidence: { plan_digest: digest, backups: plan.effect.backupIds.length, restore_copies: plan.effect.restoreCopies.length, cards: plan.cardIds.length, ...gate.evidence } }
  })
}

/**
 * The kill switch was off when this hold ended (or the switch was turned on after it): the hold has not been served by anyone able to act on it. The first enabled
 * pass re-arms a full hold with a new due notice instead of deleting a backlog at once.
 */
async function rearmUnserved(ctx: Ctx): Promise<boolean> {
  if (await holdAfterRestore(ctx)) return true
  return withTx(ctx, async (client, row) => {
    if (row.state !== 'due') return false
    const unserved = (await client.query('SELECT (hold_until < deletion_enabled_since) AS unserved FROM tenant_deletion_requests, control_plane_state WHERE id=$1', [ctx.id])).rows[0]?.unserved
    if (unserved !== true) return false
    const seq = (await client.query(`UPDATE tenant_deletion_requests SET hold_until=now() + make_interval(hours => $2),hold_notice_seq=hold_notice_seq+1,stuck_at=NULL,stuck_code=NULL,revision=revision+1 WHERE id=$1 RETURNING hold_notice_seq,hold_until`, [ctx.id, TENANT_DELETION_HOLD_HOURS])).rows[0]
    await client.query("UPDATE tenant_deletion_steps SET state='pending',error_code=NULL,next_attempt_at=NULL WHERE request_id=$1 AND step='preflight' AND state<>'done'", [ctx.id])
    await enqueueOutbox(client, dueNotice('due', ctx.id, seq.hold_notice_seq))
    await audited(client, SYSTEM, 'tenant_deletion.hold_rearmed', row.customer_id, '', { request_id: ctx.id, hold_until: seq.hold_until.toISOString() })
    return true
  })
}

/**
 * A control plane restored from a backup may have lost a withdrawal the customer made in the lost interval. Until `restored_at` plus the hold has passed, no request
 * leaves `due` (it keeps working and stays withdrawable): a `due` request whose hold would end sooner gets a fresh hold to that moment and a notice that says why.
 * A request already `deleting` and not committed when the backup was taken is returned to `due` the same way: it is withdrawn by the system (the reinstate pass restores
 * the workspace) and replaced by a fresh `due` request with the same facts and the fresh hold. Returns true when it acted.
 */
async function holdAfterRestore(ctx: Ctx): Promise<boolean> {
  return withTx(ctx, async (client, row) => {
    const restore = (await client.query(`SELECT restored_at, restored_at + make_interval(hours => $1) AS until FROM control_plane_state WHERE singleton=true AND restored_at + make_interval(hours => $1) > now()`, [TENANT_DELETION_HOLD_HOURS])).rows[0]
    if (!restore) return false
    if (row.state === 'due') {
      if (row.hold_until >= restore.until) return false
      const seq = (await client.query('UPDATE tenant_deletion_requests SET hold_until=$2,hold_notice_seq=hold_notice_seq+1,stuck_at=NULL,stuck_code=NULL,revision=revision+1 WHERE id=$1 RETURNING hold_notice_seq', [ctx.id, restore.until])).rows[0].hold_notice_seq
      await client.query("UPDATE tenant_deletion_steps SET state='pending',error_code=NULL,next_attempt_at=NULL WHERE request_id=$1 AND step='preflight' AND state<>'done'", [ctx.id])
      await enqueueOutbox(client, dueNotice('due', ctx.id, seq, 'restore'))
      await audited(client, SYSTEM, 'tenant_deletion.hold_rearmed_after_restore', row.customer_id, '', { request_id: ctx.id, hold_until: restore.until.toISOString() })
      return true
    }
    if (row.state !== 'deleting' || row.committed_at || !(row.deleting_at < restore.restored_at)) return false
    const fresh = randomUUID()
    await client.query("UPDATE tenant_deletion_requests SET state='withdrawn',withdrawn_at=now(),withdrawn_by='vendor',withdrawn_actor=$2,withdraw_reason='The control plane was restored: the request returns to its final hold',revision=revision+1 WHERE id=$1", [ctx.id, DELETION_SYSTEM_ACTOR])
    await client.query(`INSERT INTO tenant_deletion_requests(id,customer_id,state,requested_at,requested_by,requested_from,confirmed_at,confirmed_by,confirmed_from,due_at,due_marked_at,hold_until,renewal_outcome,renewal_refusal)
      SELECT $2,customer_id,'due',requested_at,requested_by,requested_from,confirmed_at,confirmed_by,confirmed_from,due_at,now(),$3,renewal_outcome,renewal_refusal FROM tenant_deletion_requests WHERE id=$1`, [ctx.id, fresh, restore.until])
    await enqueueOutbox(client, dueNotice('due', fresh, 1, 'restore'))
    await audited(client, SYSTEM, 'tenant_deletion.returned_to_hold_after_restore', row.customer_id, '', { request_id: ctx.id, new_request_id: fresh, hold_until: restore.until.toISOString() })
    return true
  })
}

const registryReason = (mode: DeletionAuthorityMode) => mode === 'retire' ? 'Tenant deletion: stop access' : 'Tenant deletion withdrawn: reinstate access'
/**
 * Publishes the registry target for this deletion through its authority (the registry publisher checks the persisted predicate), unless the binding already is what
 * the mode wants: `retire` is disabled and retired; `reinstate` is un-retired with the `enabled` the target had before access was stopped.
 */
async function publishBinding(ctx: Ctx, row: Row, tenantId: string, mode: DeletionAuthorityMode, enabledAfter = true): Promise<boolean> {
  const binding = (await ctx.pool.query('SELECT host,tenant_id,database_name,filestore,enabled,retired,registry_revision::float8 AS revision FROM shared_registry_bindings WHERE control_tenant_id=$1', [tenantId])).rows[0]
  if (!binding) throw Error('tenant_binding_unavailable')
  const retire = mode === 'retire'
  if (binding.retired === retire && binding.enabled === (retire ? false : enabledAfter)) return false
  const state = (await ctx.pool.query('SELECT revision::float8 AS revision FROM shared_registry_state WHERE singleton=true')).rows[0]
  await publishRegistryMutation(ctx.pool, ctx.registryPath, tenantDeletionActor(ctx.config, { requestId: ctx.id, planDigest: row.plan_digest, mode, enabled: retire ? false : enabledAfter }), {
    controlTenantId: tenantId, expectedSnapshotRevision: state.revision, reason: registryReason(mode),
    target: { host: binding.host, tenantId: binding.tenant_id, database: binding.database_name, filestore: binding.filestore, enabled: retire ? false : enabledAfter, retired: retire, registryRevision: binding.revision + 1 } })
  return true
}

type Prior = { registry_enabled: boolean; operations_enabled: boolean; tenant_status: string }
/** What the tenant was before access was stopped, recorded in the step's evidence before anything changes so a resume or a reinstatement restores exactly it. */
async function recordPrior(ctx: Ctx, tenantId: string): Promise<Prior> {
  return withTx(ctx, async client => {
    const existing = (await client.query("SELECT evidence->'prior' AS prior FROM tenant_deletion_steps WHERE request_id=$1 AND step='stop_access'", [ctx.id])).rows[0]?.prior
    if (existing) return existing as Prior
    const tenant = (await client.query('SELECT t.status,t.operations_enabled,b.enabled FROM tenants t JOIN shared_registry_bindings b ON b.control_tenant_id=t.id WHERE t.id=$1', [tenantId])).rows[0]
    const prior: Prior = { registry_enabled: tenant.enabled, operations_enabled: tenant.operations_enabled, tenant_status: tenant.status }
    await client.query("UPDATE tenant_deletion_steps SET evidence = evidence || jsonb_build_object('prior', $2::jsonb) WHERE request_id=$1 AND step='stop_access'", [ctx.id, JSON.stringify(prior)])
    return prior
  })
}

/** Throws `StateChanged` unless the request is still `deleting` and not withdrawn (a withdrawal can land between an effect and the write that follows it). */
const stillDeleting = (ctx: Ctx) => withTx(ctx, async (_client, row) => { if (row.state !== 'deleting' || row.withdrawn_at) throw new StateChanged() })

/** S2: the registry target is published disabled and retired, then the tenant's operations are switched off. Reversible until the commit. */
async function stopAccess(ctx: Ctx): Promise<Outcome> {
  const row = await currentRow(ctx)
  const tenantId = (await ctx.pool.query('SELECT tenant_id FROM customers WHERE id=$1', [ctx.customerId])).rows[0].tenant_id as string
  const prior = await recordPrior(ctx, tenantId)
  const published = await publishBinding(ctx, row, tenantId, 'retire')
  await withTx(ctx, async (client, locked) => {
    if (locked.state !== 'deleting' || locked.withdrawn_at) throw new StateChanged()
    await client.query("UPDATE tenants SET operations_enabled=false,status='deleting' WHERE id=$1", [tenantId])
  })
  const after = (await ctx.pool.query('SELECT enabled,retired FROM shared_registry_bindings WHERE control_tenant_id=$1', [tenantId])).rows[0]
  if (after.enabled || !after.retired) throw Error('access_not_stopped')
  return { evidence: { published, enabled: false, retired: true, prior } }
}

async function currentRow(ctx: Ctx): Promise<Row> {
  const row = (await ctx.pool.query('SELECT * FROM tenant_deletion_requests WHERE id=$1', [ctx.id])).rows[0]
  if (!row || Number(row.fence) !== ctx.fence) throw new LeaseLost()
  return row
}

/** S3: the relay refuses a disabled tenant, so its bindings go through the relay's purge route; without the relay address and token the step is skipped and says why. */
async function unbindRelay(ctx: Ctx): Promise<Outcome> {
  const row = await currentRow(ctx)
  const result = await ctx.effects.unbindRelay({ tenantId: planOf(row).relay.tenantId, assertOwned: ownership(ctx, row.plan_digest, false) })
  await stillDeleting(ctx)
  return result.state === 'not_configured' ? { skip: 'relay_not_configured' } : { evidence: { state: result.state } }
}

/**
 * Whether `fresh` differs from `frozen` only in what the plan lists: a card, backup or restore copy that appeared (added) or went (a card the customer removed, a
 * backup already purged, a copy already gone) is an explainable difference. Anything else (a database, host, tenant id, name) is not.
 */
function onlyListsDiffer(frozen: DeletionPlan, fresh: DeletionPlan): boolean {
  const { restoreCopies: _rc, backupIds: _b, ...frozenEffect } = frozen.effect
  const { restoreCopies: _rc2, backupIds: _b2, ...freshEffect } = fresh.effect
  return planDigestOf(frozenEffect) === planDigestOf(freshEffect) && planDigestOf(frozen.relay) === planDigestOf(fresh.relay) && planDigestOf(frozen.offsite) === planDigestOf(fresh.offsite)
}

/**
 * The first half of the commit: what exists now is compared with what was frozen. A card, backup or restore copy created or gone since is accounted for (the plan and its digest are
 * frozen again); any other difference defers. Every payment and order pre-check runs again; any failure defers with its code (money alerts at once).
 */
async function refreshPlan(ctx: Ctx): Promise<{ row: Row } | { defer: string; alert?: boolean }> {
  return withTx(ctx, async (client, row, tenantId) => {
    if (row.state !== 'deleting' || row.withdrawn_at) throw new StateChanged()
    const fresh = await buildDeletionPlan(client, row)
    if (planDigestOf(fresh) !== row.plan_digest) {
      if (!onlyListsDiffer(planOf(row), fresh)) return { defer: 'plan_changed', alert: true }
      const digest = planDigestOf(fresh)
      await client.query('UPDATE tenant_deletion_requests SET plan=$2::jsonb,plan_digest=$3,revision=revision+1 WHERE id=$1', [ctx.id, JSON.stringify(fresh), digest])
      await audited(client, SYSTEM, 'tenant_deletion.plan_refrozen', row.customer_id, '', { request_id: ctx.id, plan_digest: digest, cards: fresh.cardIds.length, backups: fresh.effect.backupIds.length })
    }
    const pre = await deletionPrechecks(client, row, tenantId)
    if (pre.blocked_by) return { defer: pre.blocked_by, alert: IMMEDIATE_ALERT_CHECKS.includes(pre.blocked_by) }
    return { row: (await client.query('SELECT * FROM tenant_deletion_requests WHERE id=$1', [ctx.id])).rows[0] }
  })
}

/**
 * S4: the point of no return, as late as possible. Outside the transaction the plan is refreshed and the identity is proven again for its digest (`verify`, and a dry run
 * of every destructive stage); inside it everything is checked once more against that digest. A refusal defers and the request stays withdrawable. A commit already
 * recorded is never moved.
 */
async function commit(ctx: Ctx): Promise<Outcome> {
  if ((await currentRow(ctx)).committed_at) return { evidence: { resumed: true } }
  const refreshed = await refreshPlan(ctx)
  if ('defer' in refreshed) return refreshed
  const gate = await verifyIdentity(ctx, planOf(refreshed.row).effect, ownership(ctx, refreshed.row.plan_digest, false))
  if ('defer' in gate) return gate
  return withTx(ctx, async (client, row, tenantId) => {
    if (row.state !== 'deleting' || row.withdrawn_at) throw new StateChanged()
    if (row.committed_at) return { evidence: { resumed: true } }
    const plan = planOf(row)
    if (row.plan_digest !== refreshed.row.plan_digest || planDigestOf(await buildDeletionPlan(client, row)) !== row.plan_digest) return { defer: 'plan_changed' }
    const pre = await deletionPrechecks(client, row, tenantId)
    if (pre.blocked_by) return { defer: pre.blocked_by, alert: IMMEDIATE_ALERT_CHECKS.includes(pre.blocked_by) }
    if (!(await noticeService(client, ctx.id)).served) return { defer: 'hold_not_served' }
    const binding = (await client.query('SELECT host,tenant_id,database_name,filestore,enabled,retired FROM shared_registry_bindings WHERE control_tenant_id=$1', [tenantId])).rows[0]
    if (!binding || binding.enabled || !binding.retired || binding.tenant_id !== plan.effect.tenantId || binding.database_name !== plan.effect.database
      || binding.filestore !== plan.effect.filestore || binding.host !== plan.effect.host) throw Error('binding_changed')
    const restored = (await client.query(`SELECT (restored_at + make_interval(hours => $1) > now()) AS held FROM control_plane_state WHERE singleton=true`, [TENANT_DELETION_HOLD_HOURS])).rows[0]
    if (restored?.held === true) return { defer: 'control_plane_restored' }
    await client.query('UPDATE tenant_deletion_requests SET committed_at=COALESCE(committed_at,now()),revision=revision+1 WHERE id=$1', [ctx.id])
    await audited(client, SYSTEM, 'tenant_deletion.committed', row.customer_id, '', { request_id: ctx.id, plan_digest: row.plan_digest })
    return { evidence: { committed: true, plan_digest: row.plan_digest, ...gate.evidence } }
  })
}

/**
 * S5: each saved card is deleted at the provider first, then marked removed. A card the provider will not delete is retried; after 24 hours or 12 tries the deletion
 * goes on: the card is marked removed (it can no longer be charged), its token goes to the token-deletion outbox job that keeps retrying, and the vendor item stays
 * until that job has deleted the token (`clearResolvedCardAlerts`).
 */
async function deleteCards(ctx: Ctx, info: StepInfo): Promise<Outcome> {
  const row = await currentRow(ctx)
  const failed: { id: string; brand: string | null; last_four: string | null; provider: string; mode: string; token: string | null }[] = []
  for (const id of planOf(row).cardIds) {
    const card = (await ctx.pool.query('SELECT brand,last_four,status,provider,mode,provider_token FROM payment_methods WHERE id=$1', [id])).rows[0]
    if (!card || card.status === 'removed') continue
    try {
      if (!ctx.paymentAdapter) throw Error('payment_adapter_unavailable')
      await removePaymentMethod(ctx.pool, ctx.paymentAdapter, { by: 'vendor', actor: DELETION_SYSTEM_ACTOR, reason: 'Workspace deleted', customer_id: ctx.customerId, payment_method_id: id })
    } catch { failed.push({ id, brand: card.brand, last_four: card.last_four, provider: card.provider, mode: card.mode, token: card.provider_token }) }
  }
  if (!failed.length) return { evidence: { cards: planOf(row).cardIds.length, unremoved: 0 } }
  if (info.failures + 1 < CARD_DELETE_MAX_TRIES && info.elapsedHours < DELETION_STUCK_HOURS) throw Error('card_delete_failed')
  await withTx(ctx, async (client, locked) => {
    for (const card of failed) {
      await client.query("UPDATE payment_methods SET status='removed',is_default=false,removed_at=now(),removed_by='vendor' WHERE id=$1 AND status<>'removed'", [card.id])
      if (card.token) await enqueueOutbox(client, { kind: TOKEN_DELETE_KIND, aggregate_id: card.id, dedupe_key: 'tenant-deletion', payload: { provider: card.provider, mode: card.mode, token: card.token,
        customer_id: ctx.customerId, payment_method_id: card.id, card: { brand: card.brand, last_four: card.last_four } } })
      await audited(client, SYSTEM, 'tenant_deletion.card_not_deleted', locked.customer_id, '', { request_id: ctx.id, brand: card.brand, last_four: card.last_four })
    }
    await markStuck(client, locked, 'delete_cards', 'card_not_deleted')
  })
  return { evidence: { unremoved: failed.length }, keepAlert: true }
}

/** Clears the "card not deleted" item of a request once the token-deletion job has deleted every one of its customer's tokens. */
async function clearResolvedCardAlerts(pool: Pool): Promise<void> {
  await pool.query(`UPDATE tenant_deletion_requests r SET stuck_at=NULL,stuck_code=NULL WHERE r.stuck_code='delete_cards:card_not_deleted'
    AND NOT EXISTS (SELECT 1 FROM commercial_outbox o JOIN payment_methods m ON m.id::text=o.aggregate_id WHERE o.kind=$1 AND m.customer_id=r.customer_id AND o.status IN ('pending','failed'))`, [TOKEN_DELETE_KIND])
}

/** The effect stages: one call each, by observation, with the ownership re-checked at every permit. */
async function dropStage(ctx: Ctx, stage: Exclude<DropStage, 'verify'>): Promise<Outcome> {
  const row = await currentRow(ctx)
  const effect = planOf(row).effect
  return { evidence: await ctx.effects.stage({ stage, plan: effect, planDigest: planDigestOf(effect), dryRun: false, assertOwned: ownership(ctx, row.plan_digest, true) }) }
}

/** S9: the local backups named by the plan and the control plane's own artifact files go, then the backup records are stamped purged. */
async function purgeLocalBackups(ctx: Ctx): Promise<Outcome> {
  const row = await currentRow(ctx)
  const plan = planOf(row)
  // Only this tenant's own rows: a row is named by the plan AND belongs to the plan's control tenant.
  const artifacts = (await ctx.pool.query('SELECT id,artifact_path FROM shared_backups WHERE id=ANY($1::uuid[]) AND control_tenant_id=$2 AND artifact_path IS NOT NULL', [plan.effect.backupIds, plan.effect.controlTenantId])).rows.map(r => ({ id: r.id as string, path: r.artifact_path as string }))
  const staged = (await dropStage(ctx, 'purge_local_backups') as { evidence: Record<string, unknown> }).evidence
  const files = await ctx.effects.removeBackupArtifacts(artifacts)
  const purged = await withTx(ctx, async client => (await client.query(`UPDATE shared_backups SET purged_at=now(),artifact_path=NULL,snapshot='{}'::jsonb WHERE id=ANY($1::uuid[]) AND control_tenant_id=$2 AND purged_at IS NULL`, [plan.effect.backupIds, plan.effect.controlTenantId])).rowCount ?? 0)
  return { evidence: { ...staged, artifacts: files.removed, records_purged: purged } }
}

async function purgeOffsite(ctx: Ctx): Promise<Outcome> {
  const row = await currentRow(ctx)
  return { evidence: await ctx.effects.purgeOffsite({ tenantId: planOf(row).offsite.prefix, settleSeconds: OFFSITE_SETTLE_SECONDS, assertOwned: ownership(ctx, row.plan_digest, true) }) }
}

/** S12: the registry keeps what the design says (invoices, credit notes, payments, the audit trail, this request, the trial claim, the legal name) and drops the operational rows. */
async function cleanRegistryRows(ctx: Ctx): Promise<Outcome> {
  return withTx(ctx, async (client, row, tenantId) => {
    if (!tenantId) throw Error('tenant_binding_unavailable')
    const removed = async (sql: string, params: unknown[]) => (await client.query(sql, params)).rowCount ?? 0
    const evidence = {
      usage_snapshots: await removed('DELETE FROM usage_snapshots WHERE tenant_id=$1', [tenantId]),
      usage_attempts: await removed('DELETE FROM usage_collection_attempts WHERE tenant_id=$1', [tenantId]),
      invitations: await removed('DELETE FROM admin_invitations WHERE tenant_id=$1', [tenantId]),
      outbox_closed: await removed(`UPDATE commercial_outbox SET status='failed',processed_at=now(),payload=payload || '{"error":"workspace_deleted"}'::jsonb
        WHERE status='pending' AND kind <> $2 AND kind <> $4 AND (aggregate_id=ANY($1::text[]) OR payload->>'customer_id'=$3)`, [await ownedIds(client, row.customer_id), TENANT_DELETION_NOTICE_KIND, row.customer_id, TOKEN_DELETE_KIND]),
      subscriptions: await removed("UPDATE subscriptions SET state='cancelled',auto_renew_enabled=false,revision=revision+1 WHERE customer_id=$1 AND state<>'cancelled'", [row.customer_id]),
      tenants: await removed("UPDATE tenants SET status='deleted',operations_enabled=false WHERE id=$1", [tenantId]),
    }
    return { evidence }
  })
}

/** Every id that can be the aggregate of an outbox row or the subject of an audit row for this customer, its tenant, its onboarding and its jobs and payments. */
async function ownedIds(client: Pick<PoolClient, 'query'>, customerId: string): Promise<string[]> {
  const rows = (await client.query(`SELECT id::text AS id FROM customers WHERE id=$1 UNION SELECT tenant_id::text FROM customers WHERE id=$1 AND tenant_id IS NOT NULL
    UNION SELECT id::text FROM subscriptions WHERE customer_id=$1 UNION SELECT id::text FROM orders WHERE customer_id=$1
    UNION SELECT a.id::text FROM payment_attempts a JOIN orders o ON o.id=a.order_id WHERE o.customer_id=$1
    UNION SELECT id::text FROM invoices WHERE customer_id=$1 UNION SELECT id::text FROM invoice_adjustments WHERE customer_id=$1
    UNION SELECT id::text FROM payment_methods WHERE customer_id=$1 UNION SELECT id::text FROM tenant_deletion_requests WHERE customer_id=$1
    UNION SELECT o.request_id::text FROM shared_onboardings o JOIN customers c ON c.tenant_id=o.control_tenant_id WHERE c.id=$1
    UNION SELECT j.id::text FROM shared_jobs j JOIN customers c ON c.tenant_id=j.control_tenant_id WHERE c.id=$1`, [customerId])).rows
  return rows.map(r => r.id as string)
}

/** S13: the request is `deleted`, the proof is the audit event, and the confirmation mail is queued for the address on record. */
async function finish(ctx: Ctx): Promise<Outcome> {
  return withTx(ctx, async (client, row) => {
    if (row.state === 'deleted') return { evidence: { resumed: true } }
    if (!row.committed_at) throw Error('not_committed')
    await client.query("UPDATE tenant_deletion_requests SET state='deleted',deleted_at=now(),revision=revision+1 WHERE id=$1", [ctx.id])
    await audited(client, { actor: DELETION_SYSTEM_ACTOR, client_address: null }, 'tenant_deletion.deleted', row.customer_id, '', { request_id: ctx.id, plan_digest: row.plan_digest })
    await enqueueOutbox(client, dueNotice('deleted', ctx.id))
    return { evidence: { state: 'deleted' } }
  })
}

/**
 * S14: once the final mail has really been delivered (a mail closed as stale, failed or never sent does not count; after FINAL_MAIL_DAYS or when it can no longer be
 * sent the contacts go anyway, with an alert) the administrator's name and login are removed, every pending mail of the customer is closed, and recipients, codes,
 * addresses and error texts are scrubbed from the closed outbox rows and audit records. What stays is listed in the runbook.
 */
async function anonymiseContacts(ctx: Ctx): Promise<Outcome> {
  return withTx(ctx, async (client, row, tenantId) => {
    const mail = (await client.query(`SELECT status,(payload->>'delivered'='true') AS delivered,(created_at < now() - make_interval(days => $2)) AS overdue FROM commercial_outbox WHERE kind=$3 AND dedupe_key=$1`,
      [noticeKey('deleted', ctx.id, 1), FINAL_MAIL_DAYS, TENANT_DELETION_NOTICE_KIND])).rows[0]
    const delivered = mail?.status === 'done' && mail.delivered === true
    if (!delivered && mail?.status === 'pending' && !mail.overdue) return { defer: 'final_mail_pending' }
    const ids = await ownedIds(client, row.customer_id)
    const evidence = {
      closed: (await client.query(`UPDATE commercial_outbox SET status='failed',processed_at=now(),payload=payload || '{"error":"workspace_deleted"}'::jsonb WHERE status='pending' AND kind <> $3 AND kind <> $4
        AND (aggregate_id=ANY($1::text[]) OR payload->>'customer_id'=$2)`, [ids, row.customer_id, TENANT_DELETION_NOTICE_KIND, TOKEN_DELETE_KIND])).rowCount,
      signups: (await client.query(`DELETE FROM public_signups WHERE email=(SELECT admin_login FROM customers WHERE id=$1)
        OR mobile=(SELECT mobile FROM public_signup_trials WHERE customer_id=$1)`, [row.customer_id])).rowCount,
      customers: (await client.query('UPDATE customers SET admin_name=NULL,admin_login=NULL WHERE id=$1', [row.customer_id])).rowCount,
      onboardings: (await client.query('UPDATE shared_onboardings SET admin_name=NULL,admin_login=NULL WHERE control_tenant_id=$1', [tenantId])).rowCount,
      invitations: (await client.query('UPDATE admin_invitations SET admin_login=NULL WHERE tenant_id=$1', [tenantId])).rowCount,
      outbox: (await client.query(`UPDATE commercial_outbox SET payload = jsonb_strip_keys(payload, $3::text[]) WHERE status IN ('done','failed') AND (aggregate_id=ANY($1::text[]) OR payload->>'customer_id'=$2)`, [ids, row.customer_id, PERSONAL_KEYS])).rowCount,
      audit: (await client.query(`UPDATE audit_events SET metadata = jsonb_strip_keys(metadata, $3::text[]) WHERE subject=ANY($1::text[]) OR metadata->>'customer_id'=$2`, [ids, row.customer_id, PERSONAL_KEYS])).rowCount,
    }
    if (!delivered) await markStuck(client, row, 'anonymise_contacts', 'final_mail_unsent')
    return { evidence: { ...evidence, final_mail_delivered: delivered }, keepAlert: !delivered }
  })
}

/**
 * Reinstates a request withdrawn after its access was stopped but before the point of no return: the registry target goes back to the `enabled` it had, and the tenant's
 * operations flag and status go back to exactly what the `stop_access` step recorded before it changed them (a tenant the vendor had disabled stays disabled).
 */
async function reinstate(ctx: Ctx): Promise<Outcome> {
  const row = await currentRow(ctx)
  if (row.committed_at) throw new StateChanged()
  const prior = (await ctx.pool.query("SELECT evidence->'prior' AS prior FROM tenant_deletion_steps WHERE request_id=$1 AND step='stop_access'", [ctx.id])).rows[0]?.prior as Prior | undefined
  if (!prior) return { evidence: { nothing_to_reinstate: true } }
  const tenantId = (await ctx.pool.query('SELECT tenant_id FROM customers WHERE id=$1', [ctx.customerId])).rows[0].tenant_id as string
  const published = await publishBinding(ctx, row, tenantId, 'reinstate', prior.registry_enabled)
  await withTx(ctx, async client => { await client.query("UPDATE tenants SET operations_enabled=$2,status=$3 WHERE id=$1 AND status='deleting'", [tenantId, prior.operations_enabled, prior.tenant_status]) })
  return { evidence: { published, restored: prior } }
}

/** The kill switch is off: the checks and the dry-run stages are recorded as "would do" lines, once an hour, and nothing destructive runs. */
async function recordDryRun(ctx: Ctx): Promise<void> {
  const row = await currentRow(ctx)
  const recent = (await ctx.pool.query(`SELECT 1 FROM tenant_deletion_steps WHERE request_id=$1 AND step='preflight' AND error_code=$2 AND finished_at > now() - make_interval(hours => $3)`, [ctx.id, KILL_SWITCH_OFF, DRY_RUN_EVERY_HOURS])).rowCount
  if (recent) return
  const tenantId = (await ctx.pool.query('SELECT tenant_id FROM customers WHERE id=$1', [ctx.customerId])).rows[0]?.tenant_id ?? null
  const pre = await deletionPrechecks(ctx.pool, row, tenantId)
  const lines: string[] = pre.blocked_by ? [`would defer: ${pre.blocked_by}`] : []
  let digest: string | null = null
  if (!pre.blocked_by) {
    const plan = await buildDeletionPlan(ctx.pool, row)
    digest = planDigestOf(plan)
    lines.push(`would freeze plan ${digest.slice(0, 12)}: ${plan.effect.backupIds.length} backups, ${plan.effect.restoreCopies.length} restore copies, ${plan.cardIds.length} cards`, 'would stop access and publish the registry target retired')
    const noCheck: AssertOwned = async () => {}
    for (const stage of ['verify', 'drop_database', 'remove_filestore', 'remove_restore_copies', 'purge_local_backups', 'remove_side_files'] as const) {
      try { lines.push(`would ${stage}: ${JSON.stringify(await ctx.effects.stage({ stage, plan: plan.effect, planDigest: planDigestOf(plan.effect), dryRun: true, assertOwned: noCheck }))}`) }
      catch (error) { lines.push(`${stage} refused: ${codeOf(error)}`) }
    }
    lines.push(`would purge the off-site prefix ${plan.offsite.prefix}`)
  }
  await withTx(ctx, async client => {
    await client.query(`INSERT INTO tenant_deletion_steps(request_id,step,state,intent,attempts,started_at,finished_at,error_code,evidence) VALUES($1,'preflight','skipped','dry run',1,now(),now(),$2,$3::jsonb)
      ON CONFLICT (request_id,step) DO UPDATE SET state='skipped',intent='dry run',finished_at=now(),error_code=$2,evidence=$3::jsonb`, [ctx.id, KILL_SWITCH_OFF, JSON.stringify({ would_do: lines, plan_digest: digest, checks: pre.checks })])
  })
}

const BEFORE_COMMIT: [TenantDeletionStepName, string, (ctx: Ctx, info: StepInfo) => Promise<Outcome>][] = [
  ['stop_access', 'publish the registry target disabled and retired, switch operations off', stopAccess],
  ['commit', 'cross the point of no return', commit],
]
// Everything irreversible comes after the commit. The relay purge goes first (access is stopped, the relay ignores a disabled tenant); the database is dropped, with its own
// identity gate, BEFORE the provider cards are deleted: a refusal inside `drop_database` must never find the cards already gone.
const AFTER_COMMIT: [TenantDeletionStepName, string, (ctx: Ctx, info: StepInfo) => Promise<Outcome>][] = [
  ['unbind_relay', 'remove the tenant bindings from the shared relay', unbindRelay],
  ['drop_database', 'drop the tenant database', ctx => dropStage(ctx, 'drop_database')],
  ['delete_cards', 'delete the saved cards at the provider, then mark them removed', deleteCards],
  ['remove_filestore', 'remove the tenant filestore', ctx => dropStage(ctx, 'remove_filestore')],
  ['remove_restore_copies', 'remove the restore copies named by the plan', ctx => dropStage(ctx, 'remove_restore_copies')],
  ['purge_local_backups', 'remove the local backups named by the plan', purgeLocalBackups],
  ['purge_offsite', 'purge the off-site prefix and verify it is empty', purgeOffsite],
  ['remove_side_files', 'remove the tenant side files', ctx => dropStage(ctx, 'remove_side_files')],
  ['clean_registry_rows', 'remove the operational rows of the tenant', cleanRegistryRows],
  ['finish', 'mark the request deleted and queue the final mail', finish],
  ['anonymise_contacts', 'remove the administrator contact from the records', anonymiseContacts],
]

async function runSteps(ctx: Ctx, steps: typeof BEFORE_COMMIT): Promise<boolean> {
  for (const [name, intent, body] of steps) if (await runStep(ctx, name, intent, info => body(ctx, info)) !== 'done') return false
  return true
}

/** Carries one request as far as it can go in this pass. Returns quietly when the lease is lost, the request is withdrawn, or a step must wait. */
async function advance(deps: TenantDeletionDeps, id: string): Promise<void> {
  const claim = await claimLease(deps.pool, id, ['due', 'deleting'])
  if (!claim) return
  const ctx: Ctx = { ...deps, id, ...claim }
  try {
    if (!deps.enabled) { await recordDryRun(ctx); return }
    if (await rearmUnserved(ctx)) return
    if (await runStep(ctx, 'preflight', 'check every precondition, freeze the plan', () => preflight(ctx)) !== 'done') return
    if (!await runSteps(ctx, BEFORE_COMMIT)) return
    await runSteps(ctx, AFTER_COMMIT)
  } catch (error) {
    if (!(error instanceof LeaseLost)) throw error
  } finally {
    await deps.pool.query('UPDATE tenant_deletion_requests SET lease_until=NULL WHERE id=$1 AND fence=$2', [id, claim.fence])
  }
}

/** Undoes the access stop of every request withdrawn before the point of no return. */
async function reinstateWithdrawn(deps: TenantDeletionDeps): Promise<void> {
  const ids = (await deps.pool.query(`SELECT r.id FROM tenant_deletion_requests r WHERE r.state='withdrawn' AND r.plan IS NOT NULL AND r.committed_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM tenant_deletion_steps s WHERE s.request_id=r.id AND s.step='reinstate' AND s.state='done') ORDER BY r.id LIMIT 5`)).rows
  for (const { id } of ids) {
    const claim = await claimLease(deps.pool, id, ['withdrawn'])
    if (!claim) continue
    const ctx: Ctx = { ...deps, id, ...claim }
    try { await runStep(ctx, 'reinstate', 'publish the registry target enabled again, switch operations on', () => reinstate(ctx)) }
    catch (error) { if (!(error instanceof LeaseLost)) throw error }
    finally { await deps.pool.query('UPDATE tenant_deletion_requests SET lease_until=NULL WHERE id=$1 AND fence=$2', [id, claim.fence]) }
  }
}

/** One scheduler pass: reinstates withdrawn requests, then carries every request whose hold has ended (or that is already `deleting` or `deleted` with work left) a step further. Returns the requests touched. */
export async function runTenantDeletions(deps: TenantDeletionDeps, options: { limit?: number } = {}): Promise<number> {
  // The switch's history: a hold that ended before it was first seen on was not served by a runner able to act (see rearmUnserved).
  await deps.pool.query(deps.enabled ? 'UPDATE control_plane_state SET deletion_enabled_since=COALESCE(deletion_enabled_since,now())' : 'UPDATE control_plane_state SET deletion_enabled_since=NULL WHERE deletion_enabled_since IS NOT NULL')
  await clearResolvedCardAlerts(deps.pool)
  await reinstateWithdrawn(deps)
  const ids = (await deps.pool.query(`SELECT id FROM tenant_deletion_requests WHERE ((state='due' AND hold_until <= now()) OR state='deleting'
    OR (state='deleted' AND NOT EXISTS (SELECT 1 FROM tenant_deletion_steps s WHERE s.request_id=tenant_deletion_requests.id AND s.step='anonymise_contacts' AND s.state='done')))
    -- A request waiting out a backoff or a deferral is not looked at again before its time, so a stuck one never takes the places of the others.
    AND NOT EXISTS (SELECT 1 FROM tenant_deletion_steps w WHERE w.request_id=tenant_deletion_requests.id AND w.next_attempt_at > now())
    ORDER BY (state = 'deleted'),(stuck_at IS NOT NULL),hold_until,id LIMIT $1`, [options.limit ?? 10])).rows
  let touched = 0
  for (const { id } of ids) {
    if (deps.signal?.aborted) break
    try { await advanceAny(deps, id); touched++ } catch (error) { try { deps.log?.(`tenant deletion ${id} failed`, error) } catch { /* never throw */ } }
  }
  return touched
}

/** A `deleted` request only has the anonymisation left. */
async function advanceAny(deps: TenantDeletionDeps, id: string): Promise<void> {
  const state = (await deps.pool.query('SELECT state FROM tenant_deletion_requests WHERE id=$1', [id])).rows[0]?.state
  if (state !== 'deleted') return advance(deps, id)
  const claim = await claimLease(deps.pool, id, ['deleted'])
  if (!claim) return
  const ctx: Ctx = { ...deps, id, ...claim }
  try { await runStep(ctx, 'anonymise_contacts', 'remove the administrator contact from the records', () => anonymiseContacts(ctx)) }
  catch (error) { if (!(error instanceof LeaseLost)) throw error }
  finally { await deps.pool.query('UPDATE tenant_deletion_requests SET lease_until=NULL WHERE id=$1 AND fence=$2', [id, claim.fence]) }
}
