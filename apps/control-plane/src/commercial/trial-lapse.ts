import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type { Principal } from '@liwan/commercial-contracts'
import { transaction } from '../db.js'
import { CommercialHttpError } from './lifecycle.js'
import { cancelOrder } from './orders.js'
import { freeBaseOf, HELD_QUANTITY_KEYS, heldCeilingsOf, lockEntitlement, orderFreeBase } from './free-base.js'
import { enqueueOutbox } from './outbox.js'
import type { OverLimit } from './over-limit-notices.js'
import { FREE_BASE_ORDER_WAIT_DAYS } from './notice-timings.js'
import type { PaymentAdapter } from './payment-adapter.js'
import { EXPIRY_CLEARING_REASON, expiryClearingJob, pushCommercialExpiry } from './expiry-push.js'

/**
 * What follows a trial that lapsed onto the free base. The lapse itself (`trial-expiry.ts`) already left the subscription
 * active and cleared the trial's hard expiry, so nothing here can lock the tenant. One step remains, retried hourly: the lock
 * order locks the paid applications at once, in every case, and leaves every numeric limit exactly where it was (owner decision
 * 2026-11-10). It reads no usage, so no usage check can refuse it. What the customer holds above the included quantities stays
 * with them and is never lowered automatically (owner decision 2026-11-10): once the lock is applied the lapse is `done`.
 *
 * An order the customer accepted during the trial and that applies after the lapse decides the outcome (owner decision 2026-11-10):
 * a PAID order is a conversion (the customer keeps what they paid for and is invoiced like a converted trial); anything else
 * (a zero-due change) leaves the lock owed, which is then built against the newly applied revision.
 *
 * Every attempt is explicit in `trial_lapses`: why it has not happened (`reason`) is what the vendor attention list shows.
 */
const SYSTEM_PRINCIPAL = { actor_id: 'system:trial-expiry', kind: 'vendor', customer_id: null, tenant_id: null, capabilities: ['vendor.subscriptions.manage'] } as unknown as Principal
/** Refusals the host raises before it writes anything to Odoo (`validate_reconfigure`, the expiry-revision guard and `check_downgrade` all run before the journal begins): the job can be closed and the order tried again. */
const PRE_WRITE_REFUSALS = ['downgrade_below_usage', 'tenant_upgrade_required', 'stale_target', 'tenant_binding_mismatch', 'order_not_released', 'shared_adapter_unavailable',
  'entitlement_invalid', 'features_invalid', 'commercial_expiry_revision_stale', 'input_invalid'] as const
const RETRY_HOURS = 1
const later = (now: Date, hours: number) => new Date(now.getTime() + hours * 3_600_000)

type Lapse = { subscription_id: string; trial_revision_id: string; period_start: string; lapsed_at: Date; state: 'pending' | 'ordered'; order_id: string | null; attempts: number; order_seq: number }

async function blocked(pool: Pool, lapse: Lapse, now: Date, reason: string) {
  await pool.query("UPDATE trial_lapses SET reason=$2,attempts=attempts+1,next_attempt_at=$3 WHERE subscription_id=$1 AND state='pending'",
    [lapse.subscription_id, reason.slice(0, 200), later(now, RETRY_HOURS)])
}

/** Runs every lapse that is due. One that fails never stops the others; the first failure is rethrown after them. */
export async function processTrialLapses(pool: Pool, input: { now: Date; adapter?: PaymentAdapter; subscription_id?: string }) {
  const due = (await pool.query(`SELECT subscription_id,trial_revision_id,period_start::text AS period_start,lapsed_at,state,order_id,attempts,order_seq
    FROM trial_lapses WHERE state IN ('pending','ordered') AND next_attempt_at <= $1 AND ($2::uuid IS NULL OR subscription_id=$2)
    ORDER BY subscription_id`, [input.now, input.subscription_id ?? null])).rows as Lapse[]
  const failures: unknown[] = []
  for (const lapse of due) {
    try { await (lapse.state === 'ordered' ? settleOrdered(pool, lapse, input.now) : attempt(pool, lapse, input.now, input.adapter)) }
    catch (error) { failures.push(error) }
  }
  if (failures.length) throw failures[0]
  return due.length
}

/**
 * What the customer keeps above the included quantities, told once when the lock applies: held users or storage (the marker) and
 * extra branches above the included ones. Nothing is lowered or deleted; the notice says so.
 */
async function holdings(client: Pick<PoolClient, 'query'>, subscriptionId: string, snapshot: Record<string, any>): Promise<OverLimit[]> {
  const over: OverLimit[] = Object.entries(heldCeilingsOf(snapshot)).filter(([key]) => (HELD_QUANTITY_KEYS as readonly string[]).includes(key)).map(([key, v]) => ({ key, used: v.held, free: v.target }))
  const branches = (await client.query("SELECT count(*)::int AS n FROM commercial_branches WHERE subscription_id=$1 AND kind='extra' AND state IN ('active','pending')", [subscriptionId])).rows[0].n
  if (branches > (snapshot.included_extra_branches ?? 0)) over.push({ key: 'branches.extra', used: branches, free: snapshot.included_extra_branches ?? 0 })
  return over
}

/**
 * A renewal invoice the customer never paid belongs to a configuration the tenant no longer holds: it is voided with its
 * order. An order with a live payment attempt (hosted, or a charge in flight) is left alone, because money could still
 * arrive for it; the free base is never dunned, so it can wait.
 */
async function voidUnpaidRenewals(client: PoolClient, subscriptionId: string) {
  const candidates = (await client.query(`SELECT o.id,EXISTS (SELECT 1 FROM payment_attempts a WHERE a.order_id=o.id AND a.status IN ('created','redirected','pending','unknown')) AS live
    FROM orders o WHERE o.subscription_id=$1 AND o.kind='renewal' AND NOT o.cancelled AND o.payment_state IN ('awaiting_payment','failed')
    AND o.fulfillment_state='not_started' FOR UPDATE`, [subscriptionId])).rows as { id: string; live: boolean }[]
  const orders = candidates.filter(c => !c.live).map(c => c.id)
  if (!orders.length) return
  await client.query('UPDATE orders SET cancelled=true WHERE id = ANY($1::uuid[])', [orders])
  const voided = await client.query("UPDATE invoices SET status='void' WHERE order_id = ANY($1::uuid[]) AND status='issued' RETURNING id", [orders])
  await client.query("UPDATE renewals SET status='failed' WHERE order_id = ANY($1::uuid[])", [orders])
  await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(), 'system:trial-expiry', 'trial.renewal_invoices_voided', subscriptionId, 'The subscription is on the free base: unpaid renewal invoices of the old configuration were voided', JSON.stringify({ order_ids: orders, invoice_ids: voided.rows.map(r => r.id) })])
}

/** The lock order was issued: applied ends the lapse; a failed one is released so the customer is never held behind it. */
async function settleOrdered(pool: Pool, lapse: Lapse, now: Date) {
  await transaction(pool, async client => {
    const sub = (await client.query('SELECT * FROM subscriptions WHERE id=$1 FOR UPDATE', [lapse.subscription_id])).rows[0]
    const order = (await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [lapse.order_id])).rows[0]
    if (order.fulfillment_state === 'applied') {
      const snapshot = (await client.query('SELECT snapshot FROM subscription_revisions WHERE id=$1', [order.target_revision_id])).rows[0].snapshot
      await voidUnpaidRenewals(client, sub.id)
      // The customer is told once what they keep above the included quantities; each key is its own line.
      const over = await holdings(client, sub.id, snapshot)
      if (over.length) await enqueueOutbox(client, { kind: 'trial.over_limit', aggregate_id: sub.id, dedupe_key: `over-limit:${sub.id}`, payload: { over } })
      await client.query("UPDATE trial_lapses SET state='done',trial_revision_id=$2,reason=NULL WHERE subscription_id=$1 AND state='ordered'", [lapse.subscription_id, order.target_revision_id])
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
      await client.query('UPDATE trial_lapses SET reason=$2,next_attempt_at=$3 WHERE subscription_id=$1', [lapse.subscription_id, code.slice(0, 200), later(now, RETRY_HOURS)])
      return
    }
    if (job?.state === 'needs_intervention')
      await client.query("UPDATE shared_jobs SET state='failed',lease_until=NULL WHERE id=$1 AND state='needs_intervention'", [job.id])
    await client.query('UPDATE orders SET cancelled=true WHERE id=$1', [order.id])
    await client.query('UPDATE subscriptions SET target_revision_id=NULL,revision=revision+1 WHERE id=$1 AND target_revision_id=$2', [sub.id, order.target_revision_id])
    await client.query("UPDATE trial_lapses SET state='pending',order_id=NULL,reason=$2,attempts=attempts+1,next_attempt_at=$3 WHERE subscription_id=$1",
      [lapse.subscription_id, code.slice(0, 200), later(now, RETRY_HOURS)])
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), 'system:trial-expiry', 'trial.free_base_order_superseded', sub.id, `The free-base order failed (${code}); it was cancelled so the customer can still change plan`, JSON.stringify({ order_id: order.id })])
  })
}

/**
 * The lapse cleared the trial's hard expiry in its own transaction; every pass looks at the result, because Odoo locks the
 * whole company when that expiry passes. No clearing job exists (the tenant could not take the push) -> push again, and
 * return the code while it still cannot. A job the host refused before writing anything is closed so it stops blocking the
 * tenant's queue, as a refused order job is in `settleOrdered`; the lock order that follows carries no expiry either. A job
 * that may have written to Odoo is left to the scheduler's own resume (`recoverInterrupted`) and the operator. Its state
 * stays the single record: the vendor attention list reads the job itself.
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

/**
 * The applied revision moved after the trial ended. A PAID order that applied is a conversion: the customer keeps what they
 * paid for, nothing is locked, and the subscription is invoiced like a converted trial (`past_due` from the trial end date, so
 * the renewal run issues the first invoice). A zero-due order that applied changes nothing about the outcome: the lock is
 * rebuilt against the new revision. Returns true when the lapse ended here.
 */
async function reconcileAppliedChange(pool: Pool, lapse: Lapse): Promise<boolean> {
  return transaction(pool, async client => {
    const locked = (await client.query('SELECT * FROM subscriptions WHERE id=$1 FOR UPDATE', [lapse.subscription_id])).rows[0]
    if (locked.applied_revision_id === lapse.trial_revision_id) return false
    const producing = (await client.query('SELECT * FROM orders WHERE subscription_id=$1 AND target_revision_id=$2 AND NOT cancelled ORDER BY created_at DESC,id DESC LIMIT 1', [locked.id, locked.applied_revision_id])).rows[0]
    if (producing && Number(producing.due_now_minor) > 0 && producing.payment_state === 'paid') {
      await client.query("UPDATE subscriptions SET state='past_due',renewal_at=$2::date,grace_ends_at=NULL,revision=revision+1 WHERE id=$1", [locked.id, lapse.period_start])
      await client.query("UPDATE trial_lapses SET state='superseded',reason=NULL WHERE subscription_id=$1", [lapse.subscription_id])
      await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
        [randomUUID(), 'system:trial-expiry', 'trial.converted_by_paid_order', locked.id, 'A paid order applied after the trial ended: the customer keeps what they paid for and is invoiced as a converted trial', JSON.stringify({ order_id: producing.id })])
      return true
    }
    await client.query('UPDATE trial_lapses SET trial_revision_id=$2,reason=NULL WHERE subscription_id=$1', [lapse.subscription_id, locked.applied_revision_id])
    lapse.trial_revision_id = locked.applied_revision_id
    return false
  })
}

async function attempt(pool: Pool, lapse: Lapse, now: Date, adapter?: PaymentAdapter) {
  let sub = (await pool.query('SELECT * FROM subscriptions WHERE id=$1', [lapse.subscription_id])).rows[0]
  if (sub.applied_revision_id !== lapse.trial_revision_id) {
    if (await reconcileAppliedChange(pool, lapse)) return
    sub = (await pool.query('SELECT * FROM subscriptions WHERE id=$1', [lapse.subscription_id])).rows[0]
  }
  const refused = await resumeExpiryClearing(pool, lapse)
  if (refused) return blocked(pool, lapse, now, `${EXPIRY_CLEARING_REASON}:${refused}`)
  if (sub.target_revision_id) {
    const pending = (await pool.query('SELECT * FROM orders WHERE subscription_id=$1 AND target_revision_id=$2', [sub.id, sub.target_revision_id])).rows[0]
    // ANY unpaid, not-started order is cancelled so the lock can proceed: otherwise a customer could hold an unpaid order on
    // purpose and keep the paid applications writable. The customer orders again once the lock is on.
    const staleUnpaid = pending && !pending.cancelled && pending.kind !== 'renewal' && pending.fulfillment_state === 'not_started'
      && ['awaiting_payment', 'failed'].includes(pending.payment_state)
    if (staleUnpaid) {
      try { await cancelOrder(pool, { order_id: pending.id, principal: SYSTEM_PRINCIPAL, reason: 'Trial ended with the order unpaid', adapter }) }
      // A live provider attempt that cannot be cancelled keeps the order: the vendor sees why (free_base_blocked) while the hourly retry continues.
      catch (error) { return blocked(pool, lapse, now, `pending_order_not_cancelled:${(error as { code?: string }).code ?? 'error'}`) }
    } else if (now.getTime() - new Date(lapse.lapsed_at).getTime() > FREE_BASE_ORDER_WAIT_DAYS * 86_400_000) {
      return blocked(pool, lapse, now, 'order_in_flight')
    } else {
      await pool.query("UPDATE trial_lapses SET next_attempt_at=$2 WHERE subscription_id=$1 AND state='pending'", [lapse.subscription_id, later(now, RETRY_HOURS)])
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
      const ordered = await orderFreeBase(client, { subscription: locked, snapshot, free, attempt: lapse.order_seq + 1, entitlement: lockEntitlement(free, snapshot.entitlement.features) })
      if (!ordered) throw new CommercialHttpError('free_base_already_ordered', 409)
      await client.query("UPDATE trial_lapses SET state='ordered',order_id=$2,reason=NULL,order_seq=order_seq+1,next_attempt_at=$3 WHERE subscription_id=$1",
        [lapse.subscription_id, ordered.orderId, now])
    })
  } catch (error) {
    if (!(error instanceof CommercialHttpError)) throw error
    await blocked(pool, lapse, now, error.field ? `${error.code}:${error.field}` : error.code)
  }
}
