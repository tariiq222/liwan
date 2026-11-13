import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type { Principal } from '@liwan/commercial-contracts'
import { transaction } from '../db.js'
import { CommercialHttpError } from './lifecycle.js'
import { cancelOrder } from './orders.js'
import { keptAtTrialEnd, orderFreeBaseLock, trialOutcome } from './free-base.js'
import { enqueueOutbox } from './outbox.js'
import type { PaymentAdapter } from './payment-adapter.js'

const SYSTEM_PRINCIPAL = { actor_id: 'system:free-base-lock', kind: 'vendor', customer_id: null, tenant_id: null, capabilities: ['vendor.subscriptions.manage'] } as unknown as Principal
export const LOCK_RETRY_MS = 5 * 60_000
const later = (now: Date) => new Date(now.getTime() + LOCK_RETRY_MS)

async function postpone(client: Pick<PoolClient, 'query'>, id: string, now: Date, reason: string | null) {
  await client.query("UPDATE free_base_locks SET reason=$2,next_attempt_at=$3 WHERE subscription_id=$1 AND state IN ('pending','ordered')",
    [id, reason, later(now)])
}

/**
 * The vendor's unpaid renewals of the configuration being locked: removed even for a hosted link still in flight, and
 * any later capture goes to automatic refund. `fromPeriodStart` null takes every period. The caller holds the subscription lock.
 */
export async function voidUnpaidRenewals(client: PoolClient, subscriptionId: string, fromPeriodStart: string | null) {
  const unpaid = (await client.query(`SELECT o.id,i.id AS invoice_id FROM renewals r
    JOIN orders o ON o.id=r.order_id JOIN invoices i ON i.id=r.invoice_id
    WHERE r.subscription_id=$1 AND ($2::date IS NULL OR r.period_start >= $2::date) AND i.status='issued' AND NOT o.cancelled
      AND o.payment_state IN ('awaiting_payment','failed') AND o.fulfillment_state='not_started'
    ORDER BY o.id FOR UPDATE OF o,i`, [subscriptionId, fromPeriodStart])).rows
  if (!unpaid.length) return []
  const orderIds = unpaid.map(row => row.id)
  await client.query('UPDATE orders SET cancelled=true,automatic_refund=true WHERE id=ANY($1::uuid[])', [orderIds])
  await client.query("UPDATE invoices SET status='void' WHERE id=ANY($1::uuid[])", [unpaid.map(row => row.invoice_id)])
  await client.query("UPDATE renewals SET status='superseded' WHERE order_id=ANY($1::uuid[])", [orderIds])
  return orderIds
}

/**
 * Arms the drop to the free base when the vendor records the refund of the customer's first payment, in the
 * transaction that records it. The caller already holds the note, then the subscription, then the invoice (the
 * subscription before its invoices, as every renewal, fulfilment and lock writer takes them); taking the subscription
 * again here is a no-op. A lock already ordered cannot change its target, so the record is refused until that delivery
 * settles. `pre_lock_revision_id` is the configuration applied when the lock is armed, the one a trial reopen restores.
 */
export async function armRefundLock(client: PoolClient, input: { subscription_id: string; now: Date }) {
  const sub = (await client.query('SELECT * FROM subscriptions WHERE id=$1 FOR UPDATE', [input.subscription_id])).rows[0]
  const existing = (await client.query('SELECT state,cause FROM free_base_locks WHERE subscription_id=$1 FOR UPDATE', [sub.id])).rows[0]
  if (existing?.state === 'ordered') throw new CommercialHttpError('lock_pending', 409)
  const snapshot = (await client.query('SELECT snapshot FROM subscription_revisions WHERE id=$1', [sub.applied_revision_id])).rows[0].snapshot
  // The lock replaces the current period's configuration, so it keeps that period and the renewal date stays.
  const periodStart = snapshot.period_start as string
  if (!existing || existing.state === 'superseded') {
    await client.query(`INSERT INTO free_base_locks(subscription_id,pre_lock_revision_id,period_start,armed_at,trial_ended_at,cause,next_attempt_at)
      VALUES($1,$2,$3,$4,NULL,'refund',$4)
      ON CONFLICT(subscription_id) DO UPDATE SET pre_lock_revision_id=EXCLUDED.pre_lock_revision_id,period_start=EXCLUDED.period_start,
        armed_at=EXCLUDED.armed_at,trial_ended_at=NULL,cause='refund',next_attempt_at=EXCLUDED.next_attempt_at,kept=NULL,
        customer_retry_at=NULL,state='pending',order_id=NULL,attempts=0,reason=NULL`, [sub.id, sub.applied_revision_id, periodStart, input.now])
  } else if (existing.state === 'done') {
    await client.query(`UPDATE free_base_locks SET state='pending',cause='refund',armed_at=$2,period_start=$3,pre_lock_revision_id=$4,kept=NULL,
      order_id=NULL,customer_retry_at=NULL,attempts=0,reason=NULL,next_attempt_at=$2 WHERE subscription_id=$1`, [sub.id, input.now, periodStart, sub.applied_revision_id])
  } else if (existing.cause !== 'first_invoice_unpaid') {
    // A pending first-invoice lock already takes everything; any other pending lock now judges what is still paid at the refund.
    await client.query("UPDATE free_base_locks SET cause='refund' WHERE subscription_id=$1", [sub.id])
  }
  return voidUnpaidRenewals(client, sub.id, null)
}

/** Re-arm the original lock only after voiding its first invoice. The caller holds the subscription lock. */
export async function rearmUnpaidTrialLock(client: PoolClient, subscriptionId: string, now: Date) {
  const found = (await client.query(`SELECT l.subscription_id,o.id AS order_id,i.id AS invoice_id,
      EXISTS (SELECT 1 FROM payment_attempts a WHERE a.order_id=o.id
        AND a.status IN ('created','redirected','pending','unknown')) AS live
    FROM free_base_locks l JOIN renewals r ON r.subscription_id=l.subscription_id AND r.period_start=l.period_start
    JOIN orders o ON o.id=r.order_id JOIN invoices i ON i.id=r.invoice_id
    WHERE l.subscription_id=$1 AND l.state='done' AND l.cause='trial_end' AND o.payment_state IN ('awaiting_payment','failed')
      AND o.fulfillment_state='not_started' AND NOT o.cancelled AND i.status='issued'
    FOR UPDATE OF l,o,i`, [subscriptionId])).rows[0]
  if (!found) return false
  if (found.live) return true
  await client.query('UPDATE orders SET cancelled=true,automatic_refund=true WHERE id=$1', [found.order_id])
  await client.query("UPDATE invoices SET status='void' WHERE id=$1", [found.invoice_id])
  await client.query("UPDATE renewals SET status='failed' WHERE order_id=$1", [found.order_id])
  await client.query(`UPDATE free_base_locks SET state='pending',cause='first_invoice_unpaid',order_id=NULL,reason=NULL,attempts=0,next_attempt_at=$2
    WHERE subscription_id=$1`, [subscriptionId, now])
  return true
}

/** Every subscription progresses independently, including failures and customer retries. */
export async function processFreeBaseLocks(pool: Pool, input: { now: Date; adapter?: PaymentAdapter; subscription_id?: string }) {
  const due = (await pool.query(`SELECT subscription_id FROM free_base_locks WHERE state IN ('pending','ordered')
    AND next_attempt_at <= $1 AND ($2::uuid IS NULL OR subscription_id=$2) ORDER BY subscription_id`,
  [input.now, input.subscription_id ?? null])).rows
  const failures: unknown[] = []
  for (const { subscription_id: id } of due) {
    try {
      const unpaid = await attempt(pool, id, input.now)
      if (!unpaid) continue
      try {
        await cancelOrder(pool, { order_id: unpaid, principal: SYSTEM_PRINCIPAL, reason: 'Free-base lock with the order unpaid', adapter: input.adapter })
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
            [randomUUID(), 'system:free-base-lock', 'free_base_lock.failed', id, message.slice(0, 500), '{}'])
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
    const lock = (await client.query(`SELECT *,period_start::text AS start FROM free_base_locks WHERE subscription_id=$1
      AND state IN ('pending','ordered') AND next_attempt_at <= $2 FOR UPDATE`, [id, now])).rows[0]
    if (!lock) return
    if (lock.state === 'ordered') return settleOrdered(client, sub, lock, now)
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
    // A refund keeps what is still paid at the moment it is locked: a second, unrefunded payment keeps its items.
    const cutoff = lock.cause === 'refund' ? now : lock.trial_ended_at
    const kept = await keptAtTrialEnd(client, { subscription: sub, snapshot, start: lock.start, cutoff, forceEmpty: lock.cause === 'first_invoice_unpaid' })
    const orderId = await orderFreeBaseLock(client, { subscription: sub, snapshot, lock: kept, attempt: lock.order_seq + 1 })
    await client.query(`UPDATE free_base_locks SET state='ordered',order_id=$2,pre_lock_revision_id=CASE WHEN cause='first_invoice_unpaid' THEN pre_lock_revision_id ELSE $3 END,
      kept=$4,reason=NULL,order_seq=order_seq+1,next_attempt_at=$5 WHERE subscription_id=$1`, [id, orderId, sub.applied_revision_id, JSON.stringify(kept.ledger), now])
  })
}

async function settleOrdered(client: PoolClient, sub: Record<string, any>, lock: Record<string, any>, now: Date) {
  const order = (await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [lock.order_id])).rows[0]
  if (order.fulfillment_state === 'applied') {
    const quote = (await client.query('SELECT payload FROM commercial_quotes WHERE id=$1', [order.quote_id])).rows[0].payload
    const outcome = trialOutcome(lock.kept.kept)
    const owes = quote.next_renewal.minor > 0
    // When every remaining item is already paid through the cycle, the next invoice starts at the next cycle. A refund
    // leaves the paid period's renewal date unless the locked configuration itself owes, which is billed at once.
    const renewalAt = lock.cause === 'refund' ? (owes ? lock.start : null)
      : lock.cause === 'first_invoice_unpaid' || !owes ? quote.next_renewal_at : lock.start
    // Only a subscription that had a trial has a trial outcome; a refunded paid customer who never trialled keeps none.
    const hadTrial = lock.cause !== 'refund' || lock.trial_ended_at !== null || sub.trial_outcome !== null
    // A re-armed lock can settle on what the subscription already holds (the same outcome, date and state): the revision
    // moves only with a real change, as the subscription revision guard requires.
    await client.query(`UPDATE subscriptions s SET renewal_at=v.renewal_at,trial_outcome=v.trial_outcome,trial_paid_through=v.paid_through,
      state=v.state,grace_ends_at=NULL,revision=s.revision+CASE WHEN (v.renewal_at,v.trial_outcome,v.paid_through,v.state,NULL::timestamptz)
        IS DISTINCT FROM (s.renewal_at,s.trial_outcome,s.trial_paid_through,s.state,s.grace_ends_at) THEN 1 ELSE 0 END
      FROM (SELECT COALESCE($2::date,renewal_at) AS renewal_at,CASE WHEN $5 THEN $3 ELSE trial_outcome END AS trial_outcome,$4::jsonb AS paid_through,
        CASE WHEN manual_suspension THEN state ELSE 'active' END AS state FROM subscriptions WHERE id=$1) v WHERE s.id=$1`,
    [sub.id, renewalAt, outcome, JSON.stringify(lock.kept.paid_through), hadTrial])
    await client.query("UPDATE free_base_locks SET state='done',reason=NULL WHERE subscription_id=$1", [sub.id])
    await enqueueOutbox(client, { kind: 'free_base.locked', aggregate_id: sub.id, dedupe_key: `free-base-lock:${lock.order_seq}`,
      payload: { cause: lock.cause, outcome, kept: lock.kept.kept } })
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
  await client.query(`UPDATE free_base_locks SET state='pending',order_id=NULL,reason='lock_retrying',attempts=attempts+1,next_attempt_at=$2
    WHERE subscription_id=$1`, [sub.id, later(now)])
}

export async function retryFreeBaseLock(pool: Pool, input: { customer_id: string; now: Date; adapter?: PaymentAdapter }) {
  const result = await pool.query(`UPDATE free_base_locks l SET customer_retry_at=$2,next_attempt_at=$2 FROM subscriptions s
    WHERE s.id=l.subscription_id AND s.customer_id=$1 AND NOT s.manual_suspension AND l.state IN ('pending','ordered')
      AND (l.customer_retry_at IS NULL OR l.customer_retry_at <= $2::timestamptz - interval '5 minutes')
    RETURNING l.subscription_id`, [input.customer_id, input.now])
  const id = result.rows[0]?.subscription_id
  if (id) await processFreeBaseLocks(pool, { ...input, subscription_id: id })
}
