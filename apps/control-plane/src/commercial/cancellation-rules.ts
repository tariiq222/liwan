import type { PoolClient } from 'pg'
import { owesAtRenewal, unresolvedFreeBaseLock } from './free-base.js'

/**
 * A renewal that is paid (or owes nothing) and not yet applied: the new period is bought but `renewal_at` has not moved. The rows
 * are locked, so a payment settling at the same time waits for the caller's transaction. Cancelling or dropping now would take the
 * tenant to the free base after it paid for the period; once the renewal applies, `renewal_at` moves and a cancellation means "the
 * end of the period just paid".
 */
export async function paidRenewalInFlight(client: Pick<PoolClient, 'query'>, subscriptionId: string, lock = false): Promise<boolean> {
  return (await client.query(`SELECT 1 FROM renewals r JOIN orders o ON o.id=r.order_id WHERE r.subscription_id=$1 AND r.status<>'superseded'
    AND NOT o.cancelled AND o.fulfillment_state<>'applied' AND o.payment_state IN ('paid','not_required') LIMIT 1${lock ? ' FOR UPDATE OF o' : ''}`, [subscriptionId])).rowCount === 1
}

/**
 * Why a subscription cannot be cancelled at the period end now, as the error code the routes answer, or null when it can.
 * A past-due subscription is refused: cancelling would otherwise let an unpaid invoice escape dunning, so the customer pays it
 * or lets dunning run. A renewal still waiting for payment does not block: arming the drop voids it.
 */
export async function cancelRefusal(client: Pick<PoolClient, 'query'>, sub: Record<string, any>): Promise<string | null> {
  if (sub.manual_suspension || sub.state === 'suspended') return 'subscription_suspended'
  if (!sub.applied_revision_id) return 'subscription_required'
  if (sub.state === 'trialing') return 'cancel_trial_unsupported'
  if (await unresolvedFreeBaseLock(client, sub as { id: string })) return 'lock_pending'
  if (sub.state !== 'active') return 'subscription_past_due'
  if (sub.target_revision_id || (await client.query("SELECT 1 FROM orders WHERE subscription_id=$1 AND NOT cancelled AND kind<>'renewal' AND fulfillment_state<>'applied' LIMIT 1", [sub.id])).rowCount)
    return 'subscription_change_pending'
  if (await paidRenewalInFlight(client, sub.id)) return 'renewal_in_progress'
  const pricing = (await client.query("SELECT snapshot->'pricing' AS pricing FROM subscription_revisions WHERE id=$1", [sub.applied_revision_id])).rows[0].pricing
  return owesAtRenewal(pricing) ? null : 'nothing_to_cancel'
}
