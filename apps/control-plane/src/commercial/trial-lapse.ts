import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import type { Principal } from '@liwan/commercial-contracts'
import { transaction } from '../db.js'
import { CommercialHttpError } from './lifecycle.js'
import { cancelOrder } from './orders.js'
import { assertDowngradeFitsUsage } from './usage.js'
import { freeBaseOf, orderFreeBase } from './free-base.js'
import { FREE_BASE_ORDER_WAIT_DAYS } from './notice-timings.js'
import type { PaymentAdapter } from './payment-adapter.js'

/**
 * The step after a trial lapsed onto the free base: lowering the entitlement, retried until it holds. The lapse itself
 * (`trial-expiry.ts`) already left the subscription active and cleared the trial's hard expiry, so nothing here can lock
 * the tenant; what is left is only to close the paid applications and drop the limits to the free ones.
 *
 * Every attempt is explicit in `trial_lapses`: why it has not happened (`reason`) is what the vendor attention list shows,
 * and each failure backs off (1, 2, 4 ... 24 hours). The checks come before any order, so a tenant above the free limits
 * is refused here, without a push that Odoo's worker would only refuse and leave a stuck job behind.
 */
const SYSTEM_PRINCIPAL = { actor_id: 'system:trial-expiry', kind: 'vendor', customer_id: null, tenant_id: null, capabilities: ['vendor.subscriptions.manage'] } as unknown as Principal
/** Refusals the worker raises before it writes anything to Odoo: the job can be closed and the lowering tried again. */
export const PRE_WRITE_REFUSALS = ['downgrade_below_usage', 'tenant_upgrade_required', 'stale_target', 'tenant_binding_mismatch', 'order_not_released', 'shared_adapter_unavailable'] as const
const backoffHours = (attempts: number) => Math.min(2 ** attempts, 24)

type Lapse = { subscription_id: string; trial_revision_id: string; period_start: string; lapsed_at: Date; state: 'pending' | 'ordered'; order_id: string | null; attempts: number }

async function blocked(pool: Pool, lapse: Lapse, now: Date, reason: string) {
  await pool.query(`UPDATE trial_lapses SET reason=$2,attempts=attempts+1,next_attempt_at=$3 WHERE subscription_id=$1 AND state='pending'`,
    [lapse.subscription_id, reason.slice(0, 200), new Date(now.getTime() + backoffHours(lapse.attempts + 1) * 3_600_000)])
}

/** Runs every lapse that is due. One that fails never stops the others; the first failure is rethrown after them. */
export async function processTrialLapses(pool: Pool, input: { now: Date; adapter?: PaymentAdapter; subscription_id?: string }) {
  const due = (await pool.query(`SELECT subscription_id,trial_revision_id,period_start::text AS period_start,lapsed_at,state,order_id,attempts FROM trial_lapses WHERE state IN ('pending','ordered') AND next_attempt_at <= $1 AND ($2::uuid IS NULL OR subscription_id=$2)
    ORDER BY subscription_id`, [input.now, input.subscription_id ?? null])).rows as Lapse[]
  const failures: unknown[] = []
  for (const lapse of due) {
    try { await (lapse.state === 'ordered' ? settleOrdered(pool, lapse, input.now) : attempt(pool, lapse, input.now, input.adapter)) }
    catch (error) { failures.push(error) }
  }
  if (failures.length) throw failures[0]
  return due.length
}

/** The order was issued: applied closes the lapse; a failed one is superseded so the customer is never held behind it. */
async function settleOrdered(pool: Pool, lapse: Lapse, now: Date) {
  await transaction(pool, async client => {
    const sub = (await client.query('SELECT * FROM subscriptions WHERE id=$1 FOR UPDATE', [lapse.subscription_id])).rows[0]
    const order = (await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [lapse.order_id])).rows[0]
    if (order.fulfillment_state === 'applied') {
      await client.query("UPDATE trial_lapses SET state='done',reason=NULL WHERE subscription_id=$1 AND state='ordered'", [lapse.subscription_id])
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
      await client.query('UPDATE trial_lapses SET reason=$2,next_attempt_at=$3 WHERE subscription_id=$1', [lapse.subscription_id, code.slice(0, 200), new Date(now.getTime() + 3_600_000)])
      return
    }
    if (job?.state === 'needs_intervention')
      await client.query("UPDATE shared_jobs SET state='failed',lease_until=NULL WHERE id=$1 AND state='needs_intervention'", [job.id])
    await client.query('UPDATE orders SET cancelled=true WHERE id=$1', [order.id])
    await client.query('UPDATE subscriptions SET target_revision_id=NULL,revision=revision+1 WHERE id=$1 AND target_revision_id=$2', [sub.id, order.target_revision_id])
    await client.query(`UPDATE trial_lapses SET state='pending',order_id=NULL,reason=$2,attempts=attempts+1,next_attempt_at=$3 WHERE subscription_id=$1`,
      [lapse.subscription_id, code.slice(0, 200), new Date(now.getTime() + backoffHours(lapse.attempts + 1) * 3_600_000)])
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), 'system:trial-expiry', 'trial.free_base_order_superseded', sub.id, `The free-base order failed (${code}); it was cancelled so the customer can still change plan`, JSON.stringify({ order_id: order.id })])
  })
}

async function attempt(pool: Pool, lapse: Lapse, now: Date, adapter?: PaymentAdapter) {
  const sub = (await pool.query('SELECT * FROM subscriptions WHERE id=$1', [lapse.subscription_id])).rows[0]
  // The customer changed plan after the trial: there is nothing left to lower.
  if (sub.applied_revision_id !== lapse.trial_revision_id) {
    await pool.query("UPDATE trial_lapses SET state='superseded',reason=NULL WHERE subscription_id=$1 AND state='pending'", [lapse.subscription_id])
    return
  }
  if (sub.target_revision_id) {
    const pending = (await pool.query('SELECT * FROM orders WHERE subscription_id=$1 AND target_revision_id=$2', [sub.id, sub.target_revision_id])).rows[0]
    const unpaid = pending && !pending.cancelled && pending.kind !== 'renewal' && pending.fulfillment_state === 'not_started' && ['awaiting_payment', 'failed'].includes(pending.payment_state)
    if (unpaid) {
      // An order the customer never paid is cancelled with the trial: the customer can accept a new quote at any time.
      try { await cancelOrder(pool, { order_id: pending.id, principal: SYSTEM_PRINCIPAL, reason: 'Trial ended with the order unpaid', adapter }) }
      catch (error) { return blocked(pool, lapse, now, `pending_order_not_cancelled:${(error as { code?: string }).code ?? 'error'}`) }
    } else if (now.getTime() - new Date(lapse.lapsed_at).getTime() > FREE_BASE_ORDER_WAIT_DAYS * 86_400_000) {
      return blocked(pool, lapse, now, 'order_in_flight')
    } else {
      // Paid or being fulfilled: wait for it, looking again in an hour.
      await pool.query("UPDATE trial_lapses SET next_attempt_at=$2 WHERE subscription_id=$1 AND state='pending'", [lapse.subscription_id, new Date(now.getTime() + 3_600_000)])
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
      await assertDowngradeFitsUsage(client, { tenant_id: locked.tenant_id, subscription_id: locked.id, previous: snapshot.entitlement.features, target: free.entitlement.features, now })
      const ordered = await orderFreeBase(client, { subscription: locked, snapshot, free, attempt: lapse.attempts + 1 })
      if (!ordered) throw new CommercialHttpError('free_base_already_ordered', 409)
      await client.query("UPDATE trial_lapses SET state='ordered',order_id=$2,reason=NULL,next_attempt_at=$3 WHERE subscription_id=$1", [lapse.subscription_id, ordered, now])
    })
  } catch (error) {
    if (!(error instanceof CommercialHttpError)) throw error
    await blocked(pool, lapse, now, error.field ? `${error.code}:${error.field}` : error.code)
  }
}
