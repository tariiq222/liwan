import { tenantRetiringSql } from './tenant-deletion-read.js'
import type { Pool, PoolClient } from 'pg'
import { riyadhDate } from '@liwan/commercial-contracts'
import { transaction } from '../db.js'
import { randomUUID } from 'node:crypto'
import { trialCheckoutOn, voidTrialCheckoutOn } from './trial-checkout.js'

/** A failure for one tenant never rolls back another tenant's end. */
export async function expireTrials(pool: Pool, input: { now: Date; subscription_id?: string }) {
  const lapsed: string[] = [], deferred: string[] = [], failures: unknown[] = []
  const due = (await pool.query(`SELECT s.id FROM subscriptions s
    WHERE s.state='trialing' AND NOT s.manual_suspension AND s.applied_revision_id IS NOT NULL AND s.trial_ends_at <= $1 AND NOT ${tenantRetiringSql('s.customer_id')}
      AND ($2::uuid IS NULL OR s.id=$2) ORDER BY s.id`, [input.now, input.subscription_id ?? null])).rows
  for (const { id } of due) {
    try {
      const ended = await transaction(pool, client => endTrialOn(client, id, { now: input.now }))
      if (ended === 'lapsed') lapsed.push(id)
      if (ended === 'deferred') deferred.push(id)
    } catch (error) { failures.push(error) }
  }
  if (failures.length) throw failures[0]
  return { lapsed, deferred }
}

/** Atomically record one due trial's end. An early end retains the original paid-through dates. */
export async function endTrialOn(client: PoolClient, id: string, input: { now: Date; early?: boolean }) {
  const row = (await client.query(`SELECT s.*,t.post_trial_supported,t.excess_supported FROM subscriptions s
    LEFT JOIN tenants t ON t.id=s.tenant_id WHERE s.id=$1 AND s.state='trialing' AND NOT s.manual_suspension
    AND s.applied_revision_id IS NOT NULL AND s.trial_ends_at IS NOT NULL AND ($3 OR s.trial_ends_at <= $2)
    FOR UPDATE OF s SKIP LOCKED`, [id, input.now, Boolean(input.early)])).rows[0]
  if (!row) return null
  if (row.post_trial_supported !== true || row.excess_supported !== true) return 'deferred' as const
  const cutoff = new Date(Math.min(input.now.getTime(), new Date(row.trial_ends_at).getTime()))
  const start = riyadhDate(cutoff)
  const checkout = await trialCheckoutOn(client, id)
  if (checkout) await voidTrialCheckoutOn(client, checkout)
  await client.query(`UPDATE subscriptions SET state='active',trial_ends_at=NULL,renewal_at=$2::date,grace_ends_at=NULL,
    billing_blocked_at=NULL,revision=revision+1 WHERE id=$1`, [id, start])
  const recorded = await client.query(`INSERT INTO free_base_locks(subscription_id,pre_lock_revision_id,period_start,armed_at,trial_ended_at,cause,next_attempt_at)
    VALUES($1,$2,$3,$4,$5,'trial_end',$4)
    ON CONFLICT(subscription_id) DO UPDATE SET pre_lock_revision_id=EXCLUDED.pre_lock_revision_id,period_start=EXCLUDED.period_start,
      armed_at=EXCLUDED.armed_at,trial_ended_at=EXCLUDED.trial_ended_at,next_attempt_at=EXCLUDED.next_attempt_at,kept=NULL,cause='trial_end',
      customer_retry_at=NULL,state='pending',order_id=NULL,attempts=0,reason=NULL WHERE free_base_locks.state='superseded' RETURNING subscription_id`, [id, row.applied_revision_id, start, input.now, cutoff])
  if (!recorded.rowCount) throw Error('free_base_lock_conflict')
  await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(), 'system:trial-expiry', 'trial.lapsed', id, 'Trial ended', JSON.stringify({ pre_lock_revision_id: row.applied_revision_id })])
  return 'lapsed' as const
}
