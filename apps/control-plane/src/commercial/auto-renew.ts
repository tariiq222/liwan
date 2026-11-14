import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'

/** Switches automatic renewal off inside the caller's transaction (the subscription row is locked by the caller). The saved card stays. Returns whether it was on. */
export async function disableAutoRenew(client: Pick<PoolClient, 'query'>, subscriptionId: string, who: { actor: string; reason: string }): Promise<boolean> {
  const off = await client.query('UPDATE subscriptions SET auto_renew_enabled=false,revision=revision+1 WHERE id=$1 AND auto_renew_enabled RETURNING id', [subscriptionId])
  if (!off.rowCount) return false
  await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(), who.actor, 'auto_renew.disabled', subscriptionId, who.reason, '{}'])
  return true
}

/**
 * Switches automatic renewal off when the plan of the subscription's applied revision does not allow it (a plan change, or a renewal that
 * applied a new revision): the card stays, nothing is charged. Called inside the transaction that applies the revision, which holds the
 * subscription row.
 */
export async function disableAutoRenewIfPlanForbids(client: Pick<PoolClient, 'query'>, subscriptionId: string): Promise<boolean> {
  const plan = (await client.query(`SELECT p.auto_renew_allowed FROM subscriptions s JOIN subscription_revisions r ON r.id=s.applied_revision_id
    LEFT JOIN plan_revisions p ON p.id::text = r.snapshot->>'plan_revision_id' WHERE s.id=$1`, [subscriptionId])).rows[0]
  if (!plan || plan.auto_renew_allowed) return false
  return disableAutoRenew(client, subscriptionId, { actor: 'system', reason: 'The applied plan does not allow automatic renewal' })
}
