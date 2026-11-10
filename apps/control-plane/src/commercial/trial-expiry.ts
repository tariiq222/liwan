import type { Pool, PoolClient } from 'pg'
import { riyadhDate } from '@liwan/commercial-contracts'
import { transaction } from '../db.js'
import { generateRenewals } from './renewals.js'
import { randomUUID } from 'node:crypto'
import { paidTrialLines, trialLedger } from './trial-ledger.js'
import { loadQuoteSources, pricingOf } from './quote-sources.js'
import type { ReturnOrigin } from './return-origin.js'
import type { PaymentAdapter } from './payment-adapter.js'

/** A failure for one tenant never rolls back another tenant's end. */
export async function expireTrials(pool: Pool, input: { now: Date; adapter?: PaymentAdapter; returnOrigin?: ReturnOrigin; subscription_id?: string }) {
  const lapsed: string[] = [], deferred: string[] = [], failures: unknown[] = []
  const due = (await pool.query(`SELECT id FROM subscriptions
    WHERE state='trialing' AND NOT manual_suspension AND applied_revision_id IS NOT NULL AND trial_ends_at <= $1
      AND ($2::uuid IS NULL OR id=$2) ORDER BY id`, [input.now, input.subscription_id ?? null])).rows
  for (const { id } of due) {
    try {
      const ended = await transaction(pool, client => endTrialOn(client, id, { now: input.now, convert: false }))
      if (ended === 'lapsed') lapsed.push(id)
      if (ended === 'deferred') deferred.push(id)
    } catch (error) { failures.push(error) }
  }
  if (failures.length) throw failures[0]
  return { expired: [], lapsed, deferred, orders: [] as Awaited<ReturnType<typeof generateRenewals>> }
}

/** Atomically record one due trial's end. An early end retains the original paid-through dates. */
export async function endTrialOn(client: PoolClient, id: string, input: { now: Date; convert: boolean; early?: boolean }) {
  const row = (await client.query(`SELECT s.*,t.post_trial_supported,t.excess_supported FROM subscriptions s
    LEFT JOIN tenants t ON t.id=s.tenant_id WHERE s.id=$1 AND s.state='trialing' AND NOT s.manual_suspension
    AND s.applied_revision_id IS NOT NULL AND s.trial_ends_at IS NOT NULL AND ($3 OR s.trial_ends_at <= $2)
    FOR UPDATE OF s SKIP LOCKED`, [id, input.now, input.convert || Boolean(input.early)])).rows[0]
  if (!row) return null
  if (row.post_trial_supported !== true || row.excess_supported !== true) return 'deferred' as const
  const cutoff = new Date(Math.min(input.now.getTime(), new Date(row.trial_ends_at).getTime()))
  const start = riyadhDate(cutoff)
  if (input.convert) {
    if (row.target_revision_id) return null
    const snapshot = (await client.query('SELECT snapshot FROM subscription_revisions WHERE id=$1', [row.applied_revision_id])).rows[0].snapshot
    const { plan } = await loadQuoteSources(client, row.customer_id, snapshot, false)
    const applied = await pricingOf(client, snapshot)
    const ledger = trialLedger(await paidTrialLines(client, id, cutoff), applied, plan, applied.paid_extra_branches)
    await client.query(`UPDATE subscriptions SET state='past_due',trial_ends_at=$2,renewal_at=$3,trial_paid_through=$4,
      trial_outcome='converted',trial_ended_at=$2,revision=revision+1 WHERE id=$1`, [id, cutoff, start, JSON.stringify(ledger.paid_through)])
    return 'expired' as const
  }
  await client.query(`UPDATE subscriptions SET state='active',trial_ends_at=NULL,renewal_at=$2::date,grace_ends_at=NULL,
    billing_blocked_at=NULL,revision=revision+1 WHERE id=$1`, [id, start])
  await client.query(`INSERT INTO trial_lapses(subscription_id,trial_revision_id,period_start,lapsed_at,ended_at,next_attempt_at)
    VALUES($1,$2,$3,$4,$5,$4)`, [id, row.applied_revision_id, start, input.now, cutoff])
  await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(), 'system:trial-expiry', 'trial.lapsed', id, 'Trial ended', JSON.stringify({ trial_revision_id: row.applied_revision_id })])
  return 'lapsed' as const
}
