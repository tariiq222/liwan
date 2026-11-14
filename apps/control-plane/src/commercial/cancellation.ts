import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { transaction } from '../db.js'
import { CommercialHttpError } from './lifecycle.js'
import { unresolvedFreeBaseLock } from './free-base.js'
import { cancelRefusal } from './cancellation-rules.js'
import { enqueueOutbox } from './outbox.js'
import { getSubscription } from './subscriptions.js'

export const CANCELLATION_NOTICE_KIND = 'cancellation.notice'
export type CancellationNoticeType = 'cancelled' | 'resumed' | 'ending_soon'
export type CancellationNoticePayload = { type: CancellationNoticeType; subscription_id: string; effective_on: string }

type Who = { by: 'customer' | 'vendor'; actor: string; reason: string | null }
type Target = { customer_id: string } | { subscription_id: string }

export async function lockSubscription(client: PoolClient, target: Target) {
  const sub = 'customer_id' in target
    ? (await client.query('SELECT *,renewal_at::text AS renewal_on FROM subscriptions WHERE customer_id=$1 FOR UPDATE', [target.customer_id])).rows[0]
    : (await client.query('SELECT *,renewal_at::text AS renewal_on FROM subscriptions WHERE id=$1 FOR UPDATE', [target.subscription_id])).rows[0]
  if (!sub) throw new CommercialHttpError('not_found', 404)
  return sub as Record<string, any> & { id: string }
}

async function audited(client: PoolClient, subscriptionId: string, action: string, who: Who, effectiveOn: string) {
  await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(), who.actor, action, subscriptionId, who.reason ?? '', JSON.stringify({ by: who.by, effective_on: effectiveOn })])
}

/**
 * Cancels the renewal inside the caller's transaction, with the subscription row locked by the caller. The paid period stays; on the
 * renewal date the free-base lock (cause `cancelled`) drops the subscription to the free base, so nothing is deleted and the customer
 * can buy again. The rules that refuse it are `cancelRefusal`. Asking twice changes nothing. `notify: false` queues no "cancelled"
 * notice, for a caller whose own notice already tells the customer (a confirmed workspace deletion).
 */
export async function cancelRenewalOn(client: PoolClient, sub: Record<string, any> & { id: string }, input: Who & { now: Date; notify?: boolean }) {
  if (sub.cancel_requested_at) return
  const refusal = await cancelRefusal(client, sub)
  if (refusal) throw new CommercialHttpError(refusal, 409)
  await client.query('UPDATE subscriptions SET cancel_requested_at=$2,cancel_requested_by=$3,cancel_reason=$4,revision=revision+1 WHERE id=$1',
    [sub.id, input.now, input.by, input.reason])
  const on = sub.renewal_on as string
  await audited(client, sub.id, 'subscription.cancel_requested', input, on)
  if (input.notify !== false) await enqueueOutbox(client, { kind: CANCELLATION_NOTICE_KIND, aggregate_id: sub.id, dedupe_key: `cancelled:${sub.id}:${input.now.toISOString()}`,
    payload: { type: 'cancelled', subscription_id: sub.id, effective_on: on } satisfies CancellationNoticePayload })
  // A "renewal upcoming" notice queued before the cancellation is no longer true.
  await client.query(`UPDATE commercial_outbox SET status='done',processed_at=now() WHERE kind='billing.notice' AND aggregate_id=$1
    AND status='pending' AND payload->>'type'='renewal_upcoming'`, [sub.id])
}

/** Cancels the renewal at the period end for a customer or a vendor. Asking twice changes nothing. */
export async function cancelAtPeriodEnd(pool: Pool, input: Target & Who & { now: Date }) {
  const sub = await transaction(pool, async client => {
    const sub = await lockSubscription(client, input)
    await cancelRenewalOn(client, sub, input)
    return sub
  })
  return getSubscription(pool, sub.customer_id)
}

/** Undoes the cancellation any time before the free-base lock is armed at the period end. Asking twice changes nothing. */
export async function resumeCancelled(pool: Pool, input: Target & Who & { now: Date }) {
  const sub = await transaction(pool, async client => {
    const sub = await lockSubscription(client, input)
    if (!sub.cancel_requested_at) return sub
    if (await unresolvedFreeBaseLock(client, sub)) throw new CommercialHttpError('cancel_already_effective', 409)
    await client.query('UPDATE subscriptions SET cancel_requested_at=NULL,cancel_requested_by=NULL,cancel_reason=NULL,revision=revision+1 WHERE id=$1', [sub.id])
    const on = sub.renewal_on as string
    await audited(client, sub.id, 'subscription.cancel_withdrawn', input, on)
    await enqueueOutbox(client, { kind: CANCELLATION_NOTICE_KIND, aggregate_id: sub.id, dedupe_key: `resumed:${sub.id}:${input.now.toISOString()}`,
      payload: { type: 'resumed', subscription_id: sub.id, effective_on: on } satisfies CancellationNoticePayload })
    return sub
  })
  return getSubscription(pool, sub.customer_id)
}
