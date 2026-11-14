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
