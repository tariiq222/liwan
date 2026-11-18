import type { PoolClient } from 'pg'
import { riyadhDate } from '@liwan/commercial-contracts'
import { randomUUID } from 'node:crypto'
import { dateOnly } from './date-only.js'
import { pushCommercialExpiry } from './expiry-push.js'
import { CommercialHttpError } from './lifecycle.js'

export const trialCheckoutPrefix = 'trial-checkout:'
export const isTrialCheckout = (order: { idempotency_key: string }) => order.idempotency_key.startsWith(trialCheckoutPrefix)

/** Reuse the existing payment lock order. The callers hold the subscription row. */
export async function trialCheckoutOn(client: PoolClient, subscriptionId: string) {
  return (await client.query(`SELECT o.*,r.period_start::text AS checkout_day FROM orders o
    JOIN renewals r ON r.order_id=o.id JOIN subscriptions s ON s.id=o.subscription_id
    WHERE o.subscription_id=$1 AND o.target_revision_id=s.target_revision_id
      AND o.idempotency_key LIKE $2 AND NOT o.cancelled AND o.payment_state='awaiting_payment'
    FOR UPDATE OF o`, [subscriptionId, trialCheckoutPrefix + '%'])).rows[0]
}

export async function voidTrialCheckoutOn(client: PoolClient, order: { id: string; subscription_id: string; target_revision_id: string }) {
  await client.query("UPDATE orders SET cancelled=true,automatic_refund=true WHERE id=$1", [order.id])
  await client.query("UPDATE invoices SET status='void' WHERE order_id=$1 AND status='issued'", [order.id])
  await client.query("UPDATE renewals SET status='superseded' WHERE order_id=$1", [order.id])
  await client.query('UPDATE subscriptions SET target_revision_id=NULL,revision=revision+1 WHERE id=$1 AND target_revision_id=$2',
    [order.subscription_id, order.target_revision_id])
}

/**
 * An issued invoice describes an immutable calendar period. An abandoned checkout can be reissued the next day.
 * `openedAt` is when the payment was opened: a capture of an attempt opened on the checkout day stays payable after midnight.
 */
export async function isTrialCheckoutPayable(client: PoolClient, order: { id: string; subscription_id: string; target_revision_id: string },
  now: Date, openedAt: Date = now) {
  const row = (await client.query(`SELECT s.state,s.trial_ends_at,s.manual_suspension,s.target_revision_id,r.period_start::text AS checkout_day
    FROM subscriptions s JOIN renewals r ON r.subscription_id=s.id AND r.order_id=$2 WHERE s.id=$1`,
  [order.subscription_id, order.id])).rows[0]
  return Boolean(row?.state === 'trialing' && !row.manual_suspension && row.target_revision_id === order.target_revision_id &&
    row.trial_ends_at && now < new Date(row.trial_ends_at) && dateOnly(row.checkout_day) === riyadhDate(openedAt))
}

/**
 * Called after settlement under the same subscription lock, or when the whole first period is already covered. The trial
 * deadline is lifted on the host at once, so a paying customer is never restricted while the paid revision is fulfilled.
 */
export async function markTrialCheckoutPaidOn(client: PoolClient, order: { id: string; subscription_id: string }, now: Date,
  audit: { actor: string; reason: string }) {
  const converted = await client.query(`UPDATE subscriptions SET state='active',trial_outcome='converted',trial_ended_at=$2,
    grace_ends_at=NULL,revision=revision+1 WHERE id=$1 AND state='trialing'`, [order.subscription_id, now])
  if (!converted.rowCount) return
  await client.query(`INSERT INTO audit_events(id,actor,action,subject,reason,metadata)
    VALUES($1,$2,'trial.converted',$3,$4,$5)`,
  [randomUUID(), audit.actor, order.subscription_id, audit.reason, JSON.stringify({ order_id: order.id, converted_at: now.toISOString() })])
  await pushTrialExpiryOn(client, order, null)
}

/**
 * A refund of a paid checkout whose revision was never delivered returns the subscription to the running trial: the
 * checkout is cancelled, its fulfilment is closed and the host gets the original deadline back. The paid invoice is left
 * to the caller, which queues the provider-refund credit note for it. Once a fulfilment job exists nothing is reverted.
 * Returns whether the checkout was reverted.
 */
export async function revertTrialCheckoutOn(client: PoolClient, order: { id: string; subscription_id: string; target_revision_id: string; fulfillment_state: string }) {
  if (order.fulfillment_state === 'applied') return false
  if ((await client.query('SELECT 1 FROM fulfillment_effects WHERE order_id=$1 AND job_id IS NOT NULL', [order.id])).rowCount) return false
  const reverted = (await client.query(`UPDATE subscriptions SET state='trialing',trial_outcome=NULL,trial_ended_at=NULL,revision=revision+1
    WHERE id=$1 AND state='active' AND trial_outcome='converted' AND trial_ends_at IS NOT NULL AND target_revision_id=$2
    RETURNING trial_ends_at`, [order.subscription_id, order.target_revision_id])).rows[0]
  if (!reverted) return false
  await voidTrialCheckoutOn(client, order)
  await client.query(`UPDATE commercial_outbox SET status='failed',processed_at=now(),payload=payload||jsonb_build_object('error','trial_checkout_refunded')
    WHERE kind='fulfillment.enqueue' AND aggregate_id=$1 AND status='pending'`, [order.id])
  await client.query(`INSERT INTO audit_events(id,actor,action,subject,reason,metadata)
    VALUES($1,'system:payment','trial.conversion_reverted',$2,'First period refunded before delivery; the trial runs to its deadline',$3)`,
  [randomUUID(), order.subscription_id, JSON.stringify({ order_id: order.id, trial_ends_at: new Date(reverted.trial_ends_at).toISOString() })])
  await pushTrialExpiryOn(client, order, new Date(reverted.trial_ends_at))
  return true
}

/** A refused push or a database error the push itself caused; a deadlock or serialization failure retries the whole settlement. */
function operationalPushFailure(error: unknown) {
  if (error instanceof CommercialHttpError) return true
  const code = (error as { code?: unknown })?.code
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) && code !== '40P01' && code !== '40001'
}

/** The host deadline follows settlement but an operational push failure never blocks it: the push is rolled back alone and recorded. */
async function pushTrialExpiryOn(client: PoolClient, order: { id: string; subscription_id: string }, value: Date | null) {
  await client.query('SAVEPOINT trial_expiry_push')
  try {
    await pushCommercialExpiry(client, order.subscription_id, value)
    await client.query('RELEASE SAVEPOINT trial_expiry_push')
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT trial_expiry_push')
    await client.query('RELEASE SAVEPOINT trial_expiry_push')
    if (!operationalPushFailure(error)) throw error
    const code = String((error as { code?: string })?.code ?? (error instanceof Error ? error.message : 'expiry_push_failed')).slice(0, 200)
    console.error('[payments] the trial deadline of subscription %s could not be pushed (%s)', order.subscription_id, code)
    await client.query(`INSERT INTO audit_events(id,actor,action,subject,reason,metadata)
      VALUES($1,'system:payment','trial.expiry_push_failed',$2,$3,$4)`,
    [randomUUID(), order.subscription_id, code, JSON.stringify({ order_id: order.id, trial_ends_at: value?.toISOString() ?? null })])
  }
}
