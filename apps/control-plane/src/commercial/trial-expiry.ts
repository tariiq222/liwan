import type { Pool, PoolClient } from 'pg'
import { riyadhDate } from '@liwan/commercial-contracts'
import { transaction } from '../db.js'
import { generateRenewals } from './renewals.js'
import { randomUUID } from 'node:crypto'
import { freeBaseOf } from './free-base.js'
import { EXPIRY_CLEARING_REASON, pushCommercialExpiry } from './expiry-push.js'
import { CommercialHttpError } from './lifecycle.js'
import type { ReturnOrigin } from './return-origin.js'
import type { PaymentAdapter } from './payment-adapter.js'

/**
 * Ends every trial that reached its end date and whose workspace is active (a trial still waiting for
 * activation has no applied snapshot to invoice from, so it ends once that applies).
 *
 * A trial that lapses on a plan with a free base (owner decision 2026-11-09, issue 491) keeps the subscription
 * `active`: nothing is invoiced, no grace period starts, and the trial's hard expiry is cleared in Odoo in the same
 * transaction, so that expiry can never lock a tenant whatever happens next (when the tenant cannot take the push yet, the lapse
 * still stands and records `expiry_clearing:<code>`; `processTrialLapses` retries it and the vendor sees it). Lowering the entitlement to the base is the
 * retried second step in `trial-lapse.ts`. A trial the customer converts (`convertTrial` ends it through `endTrialOn` in its own transaction), or on a plan with nothing free,
 * moves to past_due and the existing renewal path issues the first invoice and a hosted payment attempt; the renewals
 * unique key keeps a repeated run from issuing a second invoice. Ending the trial never depends on the invoice: a customer
 * without a usable return origin still leaves `trialing`, is marked billing-blocked (the vendor attention list shows it)
 * and is invoiced by a later run once its origin is fixed; the run then fails with `return_url_forbidden` so the block is
 * never silent.
 *
 * Each subscription ends in its own transaction, so one that cannot be moved never blocks the others; the first such
 * failure is rethrown after the rest are done.
 */
export async function expireTrials(pool: Pool, input: { now: Date; adapter: PaymentAdapter; returnOrigin: ReturnOrigin; subscription_id?: string }) {
  const expired: string[] = [], lapsed: string[] = [], failures: unknown[] = []
  const due = (await pool.query(`SELECT id FROM subscriptions
    WHERE state='trialing' AND applied_revision_id IS NOT NULL AND trial_ends_at IS NOT NULL AND trial_ends_at <= $1
      AND ($2::uuid IS NULL OR id=$2) ORDER BY id`, [input.now, input.subscription_id ?? null])).rows as { id: string }[]
  for (const { id } of due) {
    try {
      const ended = await transaction(pool, client => endTrialOn(client, id, { now: input.now, convert: false }))
      if (ended === 'lapsed') lapsed.push(id)
      else if (ended === 'expired') expired.push(id)
    } catch (error) { failures.push(error) }
  }
  const orders = expired.length ? await generateRenewals(pool, { now: input.now, adapter: input.adapter, returnOrigin: input.returnOrigin, subscription_id: input.subscription_id }) : []
  if (failures.length) throw failures[0]
  return { expired, lapsed, orders }
}

/**
 * Moves one subscription whose trial has ended out of `trialing`, inside the caller's transaction. A customer's conversion
 * (`convert`) calls this in the very transaction that sets the end date, so no scheduler run and no crash can come between the
 * decision and the transition and lapse a trial the customer chose to pay for. Returns what happened, or null when the
 * subscription was not due (or is being ended by another transaction).
 */
export async function endTrialOn(client: PoolClient, id: string, input: { now: Date; convert: boolean }): Promise<'lapsed' | 'expired' | null> {
  const row = (await client.query(`SELECT * FROM subscriptions WHERE id=$1 AND state='trialing' AND applied_revision_id IS NOT NULL
    AND trial_ends_at IS NOT NULL AND trial_ends_at <= $2 FOR UPDATE SKIP LOCKED`, [id, input.now])).rows[0]
  if (!row) return null
  const snapshot = (await client.query('SELECT snapshot FROM subscription_revisions WHERE id=$1', [row.applied_revision_id])).rows[0].snapshot
  const start = riyadhDate(new Date(row.trial_ends_at))
  const free = input.convert ? null : await freeBaseOf(client, { subscription: row, snapshot, start })
  if (!free) {
    await client.query("UPDATE subscriptions SET state='past_due',renewal_at=$2,revision=revision+1 WHERE id=$1", [id, start])
    return 'expired'
  }
  await client.query(`UPDATE subscriptions SET state='active',trial_ends_at=NULL,renewal_at=$2::date,grace_ends_at=NULL,billing_blocked_at=NULL,revision=revision+1 WHERE id=$1`, [id, free.end])
  await client.query('INSERT INTO trial_lapses(subscription_id,trial_revision_id,period_start,lapsed_at,next_attempt_at) VALUES($1,$2,$3,$4,$4)', [id, row.applied_revision_id, start, input.now])
  await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(), 'system:trial-expiry', 'trial.lapsed_to_free_base', id, 'Trial ended: the subscription stays active on the free base', JSON.stringify({ trial_revision_id: row.applied_revision_id })])
  // A push the tenant cannot take yet (no binding, no applied order) must not undo the lapse: the lapse row records the
  // reason, the vendor attention list shows it, and `processTrialLapses` retries the push on its normal cadence.
  await client.query('SAVEPOINT expiry_clearing')
  try { await pushCommercialExpiry(client, id, null) }
  catch (error) {
    if (!(error instanceof CommercialHttpError)) throw error
    await client.query('ROLLBACK TO SAVEPOINT expiry_clearing')
    await client.query('UPDATE trial_lapses SET reason=$2 WHERE subscription_id=$1', [id, `${EXPIRY_CLEARING_REASON}:${error.code}`])
  }
  return 'lapsed'
}
