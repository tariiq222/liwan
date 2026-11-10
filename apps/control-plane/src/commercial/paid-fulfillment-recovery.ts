import type { Pool, PoolClient } from 'pg'
import { nextOrderState } from '@liwan/commercial-contracts'
import { transaction } from '../db.js'
import { enqueueOutbox } from './outbox.js'
import { markTopupRefunded } from './ai-ledger.js'
import { recordFulfillmentFailure } from './settlements.js'

const RETRY_MINUTES = [5, 15, 60]
const PERMANENT = ['stale_target', 'provision_needs_intervention', 'order_not_released', 'renewal_missing',
  'enrollment_base_catalog_missing', 'enrollment_link_conflict', 'idempotency_conflict', 'shared_replay_forbidden']

const permanentFailure = (code: string | null) => Boolean(code && (PERMANENT.includes(code) || code.startsWith('retries_exhausted:')))

/** A known non-retryable refusal releases the target on the next pass. Others retry at 5, 15 and 60 minutes. */
export async function schedulePaidRecovery(client: PoolClient, order: Record<string, any>, code: string) {
  const minutes = permanentFailure(code) ? 0 : RETRY_MINUTES[order.fulfillment_retries] ?? 0
  await client.query(`UPDATE orders SET fulfillment_retry_at=CASE WHEN $2::int>0 THEN now()+make_interval(mins=>$2::int) ELSE NULL END,fulfillment_failure_code=$3 WHERE id=$1`,
    [order.id, minutes, code])
}

const recoverable = `(o.payment_state='paid' OR (o.payment_state='not_required' AND EXISTS (
  SELECT 1 FROM trial_lapses l WHERE l.subscription_id=o.subscription_id AND l.state='pending'
)))`

export async function recoverPaidFulfillment(pool: Pool, now = new Date()) {
  const due = (await pool.query(`SELECT id,subscription_id FROM orders o WHERE ${recoverable} AND NOT cancelled
    AND fulfillment_state IN ('failed','needs_intervention') AND COALESCE(fulfillment_retry_at,created_at)<=$1 ORDER BY created_at,id LIMIT 20`, [now])).rows
  for (const candidate of due) {
    try {
      await transaction(pool, async client => {
        const subscription = (await client.query('SELECT * FROM subscriptions WHERE id=$1 FOR UPDATE SKIP LOCKED', [candidate.subscription_id])).rows[0]
        if (!subscription) return
        const order = (await client.query(`SELECT o.* FROM orders o WHERE id=$1 AND ${recoverable} AND NOT cancelled
          AND fulfillment_state IN ('failed','needs_intervention') AND COALESCE(fulfillment_retry_at,created_at)<=$2 FOR UPDATE SKIP LOCKED`, [candidate.id, now])).rows[0]
        if (!order) return
        const open = (await client.query(`SELECT id,state FROM shared_jobs WHERE payload->>'operation'='reconfigure'
          AND payload->'authority'->>'order_id'=$1 AND state IN ('running','queued','needs_intervention')
          ORDER BY created_at DESC LIMIT 1`, [order.id])).rows[0]
        const job = open && (await client.query('SELECT id,state FROM shared_jobs WHERE id=$1 FOR UPDATE SKIP LOCKED', [open.id])).rows[0]
        if (open && (!job || ['running','queued'].includes(job.state))) return
        const currentTarget = subscription.target_revision_id === order.target_revision_id
          || order.kind === 'renewal' && subscription.applied_revision_id === order.target_revision_id
        if (currentTarget && !permanentFailure(order.fulfillment_failure_code) && order.fulfillment_retries < RETRY_MINUTES.length) {
          const next = nextOrderState(order, { type: 'fulfillment_retry' })
          await client.query(`UPDATE orders SET fulfillment_state=$2,fulfillment_retries=fulfillment_retries+1,fulfillment_retry_at=NULL WHERE id=$1`, [order.id, next.fulfillment_state])
          if (job?.state === 'needs_intervention')
            await client.query("UPDATE shared_jobs SET state='queued',lease_until=NULL WHERE id=$1", [job.id])
          else await enqueueOutbox(client, { kind: 'fulfillment.enqueue', aggregate_id: order.id, dedupe_key: `retry:${order.fulfillment_retries + 1}`,
            payload: { order_id: order.id, subscription_id: subscription.id, target_revision_id: order.target_revision_id } })
          return
        }
        if (job?.state === 'needs_intervention') await client.query("UPDATE shared_jobs SET state='failed',lease_until=NULL WHERE id=$1", [job.id])
        if (order.payment_state === 'paid') {
          await markTopupRefunded(client, order.id, 'system', 'fulfillment not delivered')
          await recordFulfillmentFailure(client, { order_id: order.id, reason: order.fulfillment_failure_code ?? 'fulfillment_not_delivered', actor: 'commercial-fulfillment' })
          await client.query("UPDATE orders SET payment_state='refund_pending' WHERE id=$1", [order.id])
          await enqueueOutbox(client, { kind: 'reconcile.refund', aggregate_id: order.id, dedupe_key: 'fulfillment-undelivered',
            payload: { attempt_id: order.paid_attempt_id, automatic: true } })
        }
        await client.query("UPDATE orders SET fulfillment_state='failed',cancelled=true,fulfillment_retry_at=NULL WHERE id=$1", [order.id])
        await client.query('UPDATE subscriptions SET target_revision_id=NULL,revision=revision+1 WHERE id=$1 AND target_revision_id=$2', [subscription.id, order.target_revision_id])
        // Reservations for failed add/restore orders must not consume capacity after release.
        await client.query(`UPDATE commercial_branches SET state=CASE WHEN odoo_company_id IS NULL THEN 'failed' ELSE 'archived' END,
          archived_at=CASE WHEN odoo_company_id IS NULL THEN NULL ELSE now() END WHERE order_id=$1 AND state='pending'`, [order.id])
      })
    } catch (error) {
      console.error(`[paid-fulfillment-recovery] order ${candidate.id}`, error)
      await pool.query(`UPDATE orders SET fulfillment_retry_at=$2 WHERE id=$1 AND NOT cancelled
        AND fulfillment_state IN ('failed','needs_intervention')`, [candidate.id, new Date(now.getTime()+5*60_000)])
        .catch(recordError => console.error(`[paid-fulfillment-recovery] could not defer ${candidate.id}`, recordError))
    }
  }
}
