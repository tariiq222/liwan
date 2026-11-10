import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type { Principal } from '@liwan/commercial-contracts'
import { transaction } from '../db.js'
import { CommercialHttpError } from './lifecycle.js'
import { cancelOrder } from './orders.js'
import { usageAgainstFreeLimits } from './usage.js'
import { freeBaseAtCeilings, freeBaseOf, orderFreeBase } from './free-base.js'
import { enqueueOutbox } from './outbox.js'
import type { OverLimit } from './over-limit-notices.js'
import { FREE_BASE_ORDER_WAIT_DAYS } from './notice-timings.js'
import type { PaymentAdapter } from './payment-adapter.js'
import { EXPIRY_CLEARING_REASON, expiryClearingJob, pushCommercialExpiry } from './expiry-push.js'

/**
 * What follows a trial that lapsed onto the free base. The lapse itself (`trial-expiry.ts`) already left the subscription
 * active and cleared the trial's hard expiry, so nothing here can lock the tenant. Two steps remain, both retried:
 *
 * 1. `pending` -> the FIRST order always locks the paid applications and leaves every numeric limit exactly where it was
 *    (owner decision 2026-11-10: lock at once, in every case). It reads no usage, so no usage check can refuse it and a
 *    customer who adds a user meanwhile cannot make the lock fail; only an infrastructure failure delays it, retried hourly.
 * 2. `limits_pending` -> each limit is lowered independently as soon as usage fits it, and a limit usage exceeds is held at
 *    that usage (nothing is deleted or archived, only adding more is refused). A refusal here just retries on the backoff
 *    and reopens nothing, because the applications are already closed.
 *
 * Every attempt is explicit in `trial_lapses`: why it has not happened (`reason`) is what the vendor attention list shows.
 */
const SYSTEM_PRINCIPAL = { actor_id: 'system:trial-expiry', kind: 'vendor', customer_id: null, tenant_id: null, capabilities: ['vendor.subscriptions.manage'] } as unknown as Principal
/** Refusals the host raises before it writes anything to Odoo (`validate_reconfigure`, the expiry-revision guard and `check_downgrade` all run before the journal begins): the job can be closed and the order tried again. */
export const PRE_WRITE_REFUSALS = ['downgrade_below_usage', 'tenant_upgrade_required', 'stale_target', 'tenant_binding_mismatch', 'order_not_released', 'shared_adapter_unavailable',
  'entitlement_invalid', 'features_invalid', 'commercial_expiry_revision_stale', 'input_invalid'] as const
/** The first lock is retried every hour; the later, lowering retries back off 1, 2, 4 ... 24 hours. */
const backoffHours = (attempts: number, state: string) => state === 'pending' ? 1 : Math.min(2 ** attempts, 24)
const later = (now: Date, hours: number) => new Date(now.getTime() + hours * 3_600_000)

type Lapse = { subscription_id: string; trial_revision_id: string; period_start: string; lapsed_at: Date; state: 'pending' | 'ordered' | 'limits_pending'; order_id: string | null; attempts: number; order_seq: number; partial: boolean; from_limits: boolean; limits_note: string | null }

async function blocked(pool: Pool, lapse: Lapse, now: Date, reason: string) {
  await pool.query(`UPDATE trial_lapses SET reason=$2,attempts=attempts+1,next_attempt_at=$3 WHERE subscription_id=$1 AND state IN ('pending','limits_pending')`,
    [lapse.subscription_id, reason.slice(0, 200), later(now, backoffHours(lapse.attempts + 1, lapse.state))])
}

/** Runs every lapse that is due. One that fails never stops the others; the first failure is rethrown after them. */
export async function processTrialLapses(pool: Pool, input: { now: Date; adapter?: PaymentAdapter; subscription_id?: string }) {
  const due = (await pool.query(`SELECT subscription_id,trial_revision_id,period_start::text AS period_start,lapsed_at,state,order_id,attempts,order_seq,partial,from_limits,limits_note
    FROM trial_lapses WHERE state IN ('pending','ordered','limits_pending') AND next_attempt_at <= $1 AND ($2::uuid IS NULL OR subscription_id=$2)
    ORDER BY subscription_id`, [input.now, input.subscription_id ?? null])).rows as Lapse[]
  const failures: unknown[] = []
  for (const lapse of due) {
    try { await (lapse.state === 'ordered' ? settleOrdered(pool, lapse, input.now) : attempt(pool, lapse, input.now, input.adapter)) }
    catch (error) { failures.push(error) }
  }
  if (failures.length) throw failures[0]
  return due.length
}

/** The order was issued: applied moves on; a failed one is superseded so the customer is never held behind it. */
async function settleOrdered(pool: Pool, lapse: Lapse, now: Date) {
  await transaction(pool, async client => {
    const sub = (await client.query('SELECT * FROM subscriptions WHERE id=$1 FOR UPDATE', [lapse.subscription_id])).rows[0]
    const order = (await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [lapse.order_id])).rows[0]
    if (order.fulfillment_state === 'applied') {
      // The applied revision is the base the next step lowers from. A partial one waits for usage; a full one only waits for
      // the old configuration's renewal invoices to settle (limits_pending finds nothing left to lower and closes the lapse).
      await client.query("UPDATE trial_lapses SET state='limits_pending',trial_revision_id=$2,partial=false,from_limits=false,reason=NULL,attempts=0,next_attempt_at=$3 WHERE subscription_id=$1 AND state='ordered'",
        [lapse.subscription_id, order.target_revision_id, now])
      return
    }
    if (!['failed', 'needs_intervention'].includes(order.fulfillment_state) && !order.cancelled) return
    const job = (await client.query(`SELECT id,state,journal->>'error_code' AS code FROM shared_jobs
      WHERE payload->>'operation'='reconfigure' AND payload->'authority'->>'order_id'=$1 FOR UPDATE`, [order.id])).rows[0]
    const code = job?.code ?? 'fulfillment_failed'
    // A refusal before any write (or no job at all) leaves Odoo untouched: the job is closed and the order released. Any
    // other failure may have written to Odoo and the job stays stuck, so the order and the target stay exactly as they are
    // (nothing is ordered behind a stuck job); the reason is shown to the vendor and the operator resolves the job.
    const untouched = !job || job.state === 'failed' || (PRE_WRITE_REFUSALS as readonly string[]).includes(code)
    if (!untouched) {
      await client.query('UPDATE trial_lapses SET reason=$2,next_attempt_at=$3 WHERE subscription_id=$1', [lapse.subscription_id, code.slice(0, 200), later(now, 1)])
      return
    }
    if (job?.state === 'needs_intervention')
      await client.query("UPDATE shared_jobs SET state='failed',lease_until=NULL WHERE id=$1 AND state='needs_intervention'", [job.id])
    await client.query('UPDATE orders SET cancelled=true WHERE id=$1', [order.id])
    await client.query('UPDATE subscriptions SET target_revision_id=NULL,revision=revision+1 WHERE id=$1 AND target_revision_id=$2', [sub.id, order.target_revision_id])
    await client.query(`UPDATE trial_lapses SET state=CASE WHEN from_limits THEN 'limits_pending' ELSE 'pending' END,order_id=NULL,partial=false,from_limits=false,reason=$2,attempts=attempts+1,next_attempt_at=$3 WHERE subscription_id=$1`,
      [lapse.subscription_id, code.slice(0, 200), later(now, backoffHours(lapse.attempts + 1, lapse.from_limits ? 'limits_pending' : 'pending'))])
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), 'system:trial-expiry', 'trial.free_base_order_superseded', sub.id, `The free-base order failed (${code}); it was cancelled so the customer can still change plan`, JSON.stringify({ order_id: order.id })])
  })
}

const describeLimits = (over: { key: string; used: number; free: number }[], unavailable: string[]) =>
  (over.length ? over.map(o => `${o.key}:${o.used}>${o.free}`).join(',') : `usage_unavailable:${unavailable.join(',')}`).slice(0, 200)

/** Active or pending extra branches beyond the ones the plan includes: reported, never held by a limit (the paid branch order is the gate). */
async function extraBranchCount(client: Pick<PoolClient, 'query'>, subscriptionId: string): Promise<number> {
  return (await client.query("SELECT count(*)::int AS n FROM commercial_branches WHERE subscription_id=$1 AND kind='extra' AND state IN ('active','pending')", [subscriptionId])).rows[0].n
}

/**
 * A renewal invoice the customer never paid belongs to a configuration the tenant no longer holds: it is voided with its
 * order. An order with a live payment attempt (hosted, or a charge in flight) is left alone, because money could still
 * arrive for it; it is looked at again on the next pass. Returns how many orders were left.
 */
async function voidUnpaidRenewals(client: PoolClient, subscriptionId: string): Promise<number> {
  const candidates = (await client.query(`SELECT o.id,EXISTS (SELECT 1 FROM payment_attempts a WHERE a.order_id=o.id AND a.status IN ('created','redirected','pending','unknown')) AS live
    FROM orders o WHERE o.subscription_id=$1 AND o.kind='renewal' AND NOT o.cancelled AND o.payment_state IN ('awaiting_payment','failed')
    AND o.fulfillment_state='not_started' FOR UPDATE`, [subscriptionId])).rows as { id: string; live: boolean }[]
  const orders = candidates.filter(c => !c.live).map(c => c.id)
  if (orders.length) {
    await client.query('UPDATE orders SET cancelled=true WHERE id = ANY($1::uuid[])', [orders])
    const voided = await client.query("UPDATE invoices SET status='void' WHERE order_id = ANY($1::uuid[]) AND status='issued' RETURNING id", [orders])
    await client.query("UPDATE renewals SET status='failed' WHERE order_id = ANY($1::uuid[])", [orders])
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), 'system:trial-expiry', 'trial.renewal_invoices_voided', subscriptionId, 'The subscription is on the free base: unpaid renewal invoices of the old configuration were voided', JSON.stringify({ order_ids: orders, invoice_ids: voided.rows.map(r => r.id) })])
  }
  return candidates.length - orders.length
}

/**
 * The lapse cleared the trial's hard expiry in its own transaction; every pass of the first step looks at the result, because
 * Odoo locks the whole company when that expiry passes. No clearing job exists (the tenant could not take the push) -> push
 * again, and return the code while it still cannot. A job the host refused before writing anything is closed so it stops
 * blocking the tenant's queue, as a refused order job is in `settleOrdered`; the lock order that follows carries no expiry
 * either. A job that may have written to Odoo is left to the scheduler's own resume (`recoverInterrupted`) and the operator.
 * Its state stays the single record: the vendor attention list reads the job itself.
 */
async function resumeExpiryClearing(pool: Pool, lapse: Lapse): Promise<string | null> {
  return transaction(pool, async client => {
    const sub = (await client.query('SELECT * FROM subscriptions WHERE id=$1 FOR UPDATE', [lapse.subscription_id])).rows[0]
    if (sub.applied_revision_id !== lapse.trial_revision_id) return null
    const job = (await client.query(`SELECT j.id,j.state,j.journal->>'stage' AS stage,j.journal->>'error_code' AS code FROM shared_jobs j
      WHERE ${expiryClearingJob('j', '$1', '$2')} ORDER BY j.created_at DESC,j.id DESC LIMIT 1 FOR UPDATE`, [sub.tenant_id, lapse.trial_revision_id])).rows[0]
    if (!job) {
      try { await pushCommercialExpiry(client, sub.id, null) }
      catch (error) { if (error instanceof CommercialHttpError) return error.code; throw error }
    } else if (job.state === 'needs_intervention' && job.stage === 'needs_intervention' && (PRE_WRITE_REFUSALS as readonly string[]).includes(job.code)) {
      await client.query("UPDATE shared_jobs SET state='failed',lease_until=NULL WHERE id=$1 AND state='needs_intervention'", [job.id])
      await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
        [randomUUID(), 'system:trial-expiry', 'trial.expiry_clearing_job_closed', sub.id, `The job clearing the trial expiry was refused before any write (${job.code}); it was closed so the tenant's queue is not blocked`, JSON.stringify({ job_id: job.id })])
    }
    await client.query('UPDATE trial_lapses SET reason=NULL WHERE subscription_id=$1 AND reason LIKE $2', [lapse.subscription_id, `${EXPIRY_CLEARING_REASON}:%`])
    return null
  })
}

async function attempt(pool: Pool, lapse: Lapse, now: Date, adapter?: PaymentAdapter) {
  const sub = (await pool.query('SELECT * FROM subscriptions WHERE id=$1', [lapse.subscription_id])).rows[0]
  // The customer changed plan after the trial: there is nothing left to lower.
  if (sub.applied_revision_id !== lapse.trial_revision_id) {
    await pool.query("UPDATE trial_lapses SET state='superseded',reason=NULL,limits_note=NULL WHERE subscription_id=$1 AND state IN ('pending','limits_pending')", [lapse.subscription_id])
    return
  }
  if (lapse.state === 'pending') {
    const refused = await resumeExpiryClearing(pool, lapse)
    if (refused) return blocked(pool, lapse, now, `${EXPIRY_CLEARING_REASON}:${refused}`)
  }
  if (sub.target_revision_id) {
    const pending = (await pool.query('SELECT * FROM orders WHERE subscription_id=$1 AND target_revision_id=$2', [sub.id, sub.target_revision_id])).rows[0]
    // In the first step (the lock has not been placed yet) ANY unpaid, not-started order is cancelled so the lock can proceed:
    // otherwise a customer could hold an unpaid order on purpose and keep the paid applications writable. The customer
    // orders again once the lock is on. Once on the base (limits_pending) an order the customer starts is never touched,
    // only waited for.
    const staleUnpaid = lapse.state === 'pending' && pending && !pending.cancelled && pending.kind !== 'renewal' && pending.fulfillment_state === 'not_started'
      && ['awaiting_payment', 'failed'].includes(pending.payment_state)
    if (staleUnpaid) {
      try { await cancelOrder(pool, { order_id: pending.id, principal: SYSTEM_PRINCIPAL, reason: 'Trial ended with the order unpaid', adapter }) }
      // A live provider attempt that cannot be cancelled keeps the order: the vendor sees why (free_base_blocked) while the hourly retry continues.
      catch (error) { return blocked(pool, lapse, now, `pending_order_not_cancelled:${(error as { code?: string }).code ?? 'error'}`) }
    } else if (lapse.state === 'pending' && now.getTime() - new Date(lapse.lapsed_at).getTime() > FREE_BASE_ORDER_WAIT_DAYS * 86_400_000) {
      return blocked(pool, lapse, now, 'order_in_flight')
    } else {
      await pool.query("UPDATE trial_lapses SET next_attempt_at=$2 WHERE subscription_id=$1 AND state IN ('pending','limits_pending')", [lapse.subscription_id, later(now, 1)])
      return
    }
  }
  try {
    await transaction(pool, async client => {
      const locked = (await client.query('SELECT * FROM subscriptions WHERE id=$1 FOR UPDATE', [lapse.subscription_id])).rows[0]
      if (locked.target_revision_id || locked.applied_revision_id !== lapse.trial_revision_id) throw new CommercialHttpError('order_in_flight', 409)
      const snapshot = (await client.query('SELECT snapshot FROM subscription_revisions WHERE id=$1', [lapse.trial_revision_id])).rows[0].snapshot
      const free = await freeBaseOf(client, { subscription: locked, snapshot, start: lapse.period_start })
      if (!free) throw new CommercialHttpError('free_base_unavailable', 409)
      const settling = lapse.state === 'limits_pending' ? await voidUnpaidRenewals(client, locked.id) : 0
      // The first step reads no usage (every lowered limit is "unavailable" = kept as it is); the later steps judge each limit alone.
      const usage = await usageAgainstFreeLimits(client, { tenant_id: locked.tenant_id, previous: snapshot.entitlement.features, target: free.entitlement.features, now, skipSample: lapse.state === 'pending' })
      // Keys come only from the entitlement's own fixed key list; the usage sample is looked up by those keys, never the other way
      // round, so nothing a sample contains can name a key to write.
      const previous = new Map(Object.entries(snapshot.entitlement.features as Record<string, number | boolean | null>))
      const usedBy = new Map(usage.over.map(o => [o.key, o.used]))
      const unknown = new Set(usage.unavailable)
      const ceilings = new Map<string, number | null>()
      for (const key of Object.keys(free.entitlement.features)) {
        const before = previous.get(key)
        if (usedBy.has(key)) ceilings.set(key, typeof before === 'number' ? Math.min(usedBy.get(key)!, before) : usedBy.get(key)!)
        else if (unknown.has(key)) ceilings.set(key, typeof before === 'number' ? before : null)
      }
      const desired = ceilings.size ? freeBaseAtCeilings(free, ceilings) : free.entitlement
      const note = describeLimits(usage.over, usage.unavailable)
      const branches = await extraBranchCount(client, locked.id)
      const overBranches = branches > (snapshot.included_extra_branches ?? 0)
      if (lapse.state === 'limits_pending') {
        // The customer is told once what exceeds (or, with no sample, that the limits will be reviewed); each key is its own notice.
        const over: OverLimit[] = [...usage.over]
        if (overBranches) over.push({ key: 'branches.extra', used: branches, free: snapshot.included_extra_branches ?? 0 })
        if (over.length) await enqueueOutbox(client, { kind: 'trial.over_limit', aggregate_id: locked.id, dedupe_key: `over-limit:${locked.id}:named`, payload: { over } })
        else if (usage.unavailable.length) await enqueueOutbox(client, { kind: 'trial.over_limit', aggregate_id: locked.id, dedupe_key: `over-limit:${locked.id}:generic`, payload: { over: [], generic: true } })
        if (desired.digest === snapshot.entitlement.digest) {
          // Nothing more can be lowered now. Done when it is the full base and the old invoices are settled; otherwise look again.
          const complete = desired.digest === free.entitlement.digest && settling === 0
          await client.query(complete
            ? "UPDATE trial_lapses SET state='done',reason=NULL,limits_note=NULL WHERE subscription_id=$1 AND state='limits_pending'"
            : "UPDATE trial_lapses SET limits_note=$2,reason=NULL,attempts=attempts+1,next_attempt_at=$3 WHERE subscription_id=$1 AND state='limits_pending'",
          complete ? [lapse.subscription_id] : [lapse.subscription_id, desired.digest === free.entitlement.digest ? null : note, later(now, backoffHours(lapse.attempts + 1, 'limits_pending'))])
          return
        }
      }
      const ordered = await orderFreeBase(client, { subscription: locked, snapshot, free, attempt: lapse.order_seq + 1, entitlement: desired })
      if (!ordered) throw new CommercialHttpError('free_base_already_ordered', 409)
      const partial = desired.digest !== free.entitlement.digest
      await client.query("UPDATE trial_lapses SET state='ordered',order_id=$2,reason=NULL,partial=$3,from_limits=$4,limits_note=$5,order_seq=order_seq+1,next_attempt_at=$6 WHERE subscription_id=$1",
        [lapse.subscription_id, ordered.orderId, partial, lapse.state === 'limits_pending', partial ? note : null, now])
    })
  } catch (error) {
    if (!(error instanceof CommercialHttpError)) throw error
    await blocked(pool, lapse, now, error.field ? `${error.code}:${error.field}` : error.code)
  }
}
