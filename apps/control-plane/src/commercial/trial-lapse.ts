import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type { Principal } from '@liwan/commercial-contracts'
import { transaction } from '../db.js'
import { CommercialHttpError } from './lifecycle.js'
import { cancelOrder } from './orders.js'
import { keptAtTrialEnd, orderTrialLock, trialOutcome } from './free-base.js'
import { enqueueOutbox } from './outbox.js'
import type { PaymentAdapter } from './payment-adapter.js'

const SYSTEM_PRINCIPAL = { actor_id: 'system:trial-expiry', kind: 'vendor', customer_id: null, tenant_id: null, capabilities: ['vendor.subscriptions.manage'] } as unknown as Principal
export const LAPSE_RETRY_MS = 5 * 60_000
const later = (now: Date) => new Date(now.getTime() + LAPSE_RETRY_MS)

async function postpone(client: Pick<PoolClient, 'query'>, id: string, now: Date, reason: string | null) {
  await client.query("UPDATE trial_lapses SET reason=$2,next_attempt_at=$3 WHERE subscription_id=$1 AND state IN ('pending','ordered')",
    [id, reason, later(now)])
}

/** Re-arm the original lapse only after voiding its first invoice. The caller holds the subscription lock. */
export async function rearmUnpaidTrialLock(client: PoolClient, subscriptionId: string, now: Date) {
  const found = (await client.query(`SELECT l.subscription_id,o.id AS order_id,i.id AS invoice_id,
      EXISTS (SELECT 1 FROM payment_attempts a WHERE a.order_id=o.id
        AND a.status IN ('created','redirected','pending','unknown')) AS live
    FROM trial_lapses l JOIN renewals r ON r.subscription_id=l.subscription_id AND r.period_start=l.period_start
    JOIN orders o ON o.id=r.order_id JOIN invoices i ON i.id=r.invoice_id
    WHERE l.subscription_id=$1 AND l.state='done' AND NOT l.force_empty AND o.payment_state IN ('awaiting_payment','failed')
      AND o.fulfillment_state='not_started' AND NOT o.cancelled AND i.status='issued'
    FOR UPDATE OF l,o,i`, [subscriptionId])).rows[0]
  if (!found) return false
  if (found.live) return true
  await client.query('UPDATE orders SET cancelled=true,automatic_refund=true WHERE id=$1', [found.order_id])
  await client.query("UPDATE invoices SET status='void' WHERE id=$1", [found.invoice_id])
  await client.query("UPDATE renewals SET status='failed' WHERE order_id=$1", [found.order_id])
  await client.query(`UPDATE trial_lapses SET state='pending',force_empty=true,order_id=NULL,reason=NULL,attempts=0,next_attempt_at=$2
    WHERE subscription_id=$1`, [subscriptionId, now])
  return true
}

/** Every subscription progresses independently, including failures and customer retries. */
export async function processTrialLapses(pool: Pool, input: { now: Date; adapter?: PaymentAdapter; subscription_id?: string }) {
  const due = (await pool.query(`SELECT subscription_id FROM trial_lapses WHERE state IN ('pending','ordered')
    AND next_attempt_at <= $1 AND ($2::uuid IS NULL OR subscription_id=$2) ORDER BY subscription_id`,
  [input.now, input.subscription_id ?? null])).rows
  const failures: unknown[] = []
  for (const { subscription_id: id } of due) {
    try {
      const unpaid = await attempt(pool, id, input.now)
      if (!unpaid) continue
      try {
        await cancelOrder(pool, { order_id: unpaid, principal: SYSTEM_PRINCIPAL, reason: 'Trial ended with the order unpaid', adapter: input.adapter })
      } catch (error) {
        if (!(error instanceof CommercialHttpError)) throw error
        await postpone(pool, id, input.now, `pending_order_not_cancelled:${error.code}`)
        continue
      }
      await attempt(pool, id, input.now)
    } catch (error) {
      const reason = error instanceof CommercialHttpError ? error.code : 'unexpected_error'
      const message = error instanceof Error ? error.message : String(error)
      try {
        await transaction(pool, async client => {
          await postpone(client, id, input.now, reason)
          await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
            [randomUUID(), 'system:trial-expiry', 'trial.lapse_failed', id, message.slice(0, 500), '{}'])
        })
      } catch (recordError) { failures.push(recordError) }
      failures.push(error)
    }
  }
  if (failures.length) throw failures[0]
  return due.length
}

async function attempt(pool: Pool, id: string, now: Date): Promise<string | undefined> {
  return transaction(pool, async client => {
    const sub = (await client.query('SELECT * FROM subscriptions WHERE id=$1 FOR UPDATE SKIP LOCKED', [id])).rows[0]
    if (!sub) return
    const lapse = (await client.query(`SELECT *,period_start::text AS start FROM trial_lapses WHERE subscription_id=$1
      AND state IN ('pending','ordered') AND next_attempt_at <= $2 FOR UPDATE`, [id, now])).rows[0]
    if (!lapse) return
    if (lapse.state === 'ordered') return settleOrdered(client, sub, lapse, now)
    if (sub.target_revision_id) {
      const pending = (await client.query('SELECT * FROM orders WHERE subscription_id=$1 AND target_revision_id=$2 AND NOT cancelled', [id, sub.target_revision_id])).rows[0]
      if (pending && pending.kind !== 'renewal' && pending.fulfillment_state === 'not_started'
        && ['awaiting_payment', 'failed'].includes(pending.payment_state)) return pending.id
      await postpone(client, id, now, 'order_in_flight')
      return
    }
    const tenant = (await client.query('SELECT post_trial_supported,excess_supported FROM tenants WHERE id=$1', [sub.tenant_id])).rows[0]
    if (tenant?.post_trial_supported !== true || tenant.excess_supported !== true) {
      await postpone(client, id, now, 'tenant_upgrade_required')
      return
    }
    const snapshot = (await client.query('SELECT snapshot FROM subscription_revisions WHERE id=$1', [sub.applied_revision_id])).rows[0].snapshot
    const lock = await keptAtTrialEnd(client, { subscription: sub, snapshot, start: lapse.start, cutoff: lapse.ended_at, forceEmpty: lapse.force_empty })
    const orderId = await orderTrialLock(client, { subscription: sub, snapshot, lock, attempt: lapse.order_seq + 1 })
    await client.query(`UPDATE trial_lapses SET state='ordered',order_id=$2,trial_revision_id=$3,kept=$4,reason=NULL,
      order_seq=order_seq+1,next_attempt_at=$5 WHERE subscription_id=$1`, [id, orderId, sub.applied_revision_id, JSON.stringify(lock.ledger), now])
  })
}

async function settleOrdered(client: PoolClient, sub: Record<string, any>, lapse: Record<string, any>, now: Date) {
  const order = (await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [lapse.order_id])).rows[0]
  if (order.fulfillment_state === 'applied') {
    const quote = (await client.query('SELECT payload FROM commercial_quotes WHERE id=$1', [order.quote_id])).rows[0].payload
    const outcome = trialOutcome(lapse.kept.kept)
    // When every remaining item is already paid through the cycle, the next invoice starts at the next cycle.
    const renewalAt = lapse.force_empty || quote.next_renewal.minor === 0 ? quote.next_renewal_at : lapse.start
    await client.query(`UPDATE subscriptions SET renewal_at=$2::date,trial_outcome=$3,trial_paid_through=$4,
      state=CASE WHEN manual_suspension THEN state ELSE 'active' END,grace_ends_at=NULL,revision=revision+1 WHERE id=$1`,
    [sub.id, renewalAt, outcome, JSON.stringify(lapse.kept.paid_through)])
    await client.query("UPDATE trial_lapses SET state='done',reason=NULL WHERE subscription_id=$1", [sub.id])
    await enqueueOutbox(client, { kind: 'trial.over_limit', aggregate_id: sub.id, dedupe_key: `trial-end:${lapse.order_seq}`,
      payload: { outcome, force_empty: lapse.force_empty, kept: lapse.kept.kept } })
    return
  }
  if (order.fulfillment_state !== 'failed' && !order.cancelled) {
    await postpone(client, sub.id, now, order.fulfillment_state === 'needs_intervention' ? 'lock_retrying' : null)
    return
  }
  const open = await client.query(`SELECT 1 FROM shared_jobs WHERE payload->'authority'->>'order_id'=$1
    AND state IN ('queued','running','needs_intervention')`, [order.id])
  if (open.rowCount) return postpone(client, sub.id, now, 'lock_retrying')
  await client.query('UPDATE orders SET cancelled=true WHERE id=$1', [order.id])
  await client.query('UPDATE subscriptions SET target_revision_id=NULL,revision=revision+1 WHERE id=$1 AND target_revision_id=$2', [sub.id, order.target_revision_id])
  await client.query(`UPDATE trial_lapses SET state='pending',order_id=NULL,reason='lock_retrying',attempts=attempts+1,next_attempt_at=$2
    WHERE subscription_id=$1`, [sub.id, later(now)])
}

export async function retryTrialLapse(pool: Pool, input: { customer_id: string; now: Date; adapter?: PaymentAdapter }) {
  const result = await pool.query(`UPDATE trial_lapses l SET customer_retry_at=$2,next_attempt_at=$2 FROM subscriptions s
    WHERE s.id=l.subscription_id AND s.customer_id=$1 AND NOT s.manual_suspension AND l.state IN ('pending','ordered')
      AND (l.customer_retry_at IS NULL OR l.customer_retry_at <= $2::timestamptz - interval '5 minutes')
    RETURNING l.subscription_id`, [input.customer_id, input.now])
  const id = result.rows[0]?.subscription_id
  if (id) await processTrialLapses(pool, { ...input, subscription_id: id })
}
