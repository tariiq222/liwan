import type { Pool } from 'pg'
import { riyadhDate } from '@liwan/commercial-contracts'
import { transaction } from '../db.js'
import { generateRenewals } from './renewals.js'
import { freeBaseOf, moveToFreeBase } from './free-base.js'
import type { ReturnOrigin } from './return-origin.js'
import type { PaymentAdapter } from './payment-adapter.js'

/**
 * Ends every trial that reached its end date and whose workspace is active (a trial still waiting for
 * activation has no applied snapshot to invoice from, so it ends once that applies).
 *
 * A trial that lapses on a plan with a free base (owner decision 2026-11-09, issue 491) keeps the subscription
 * `active` on that base: only the paid applications lock, nothing is invoiced and no grace period starts. A trial the
 * customer converts (`convert`), or on a plan with nothing free, moves to past_due and the existing renewal path
 * issues the first invoice and a hosted payment attempt; the renewals unique key keeps a repeated run from issuing a
 * second invoice. Ending the trial never depends on the invoice: a customer without a usable return origin still leaves
 * `trialing`, is marked billing-blocked (the vendor attention list shows it) and is invoiced by a later run once its
 * origin is fixed; the run then fails with `return_url_forbidden` so the block is never silent.
 *
 * Each subscription ends in its own transaction, so one that cannot be moved never blocks the others; the first such
 * failure is rethrown after the rest are done. A subscription with an accepted order still in flight keeps its trial
 * until that order is applied or cancelled, because only one target revision can be pending.
 */
export async function expireTrials(pool: Pool, input: { now: Date; adapter: PaymentAdapter; returnOrigin: ReturnOrigin; subscription_id?: string; convert?: boolean }) {
  const expired: string[] = [], lapsed: string[] = [], failures: unknown[] = []
  const due = (await pool.query(`SELECT id FROM subscriptions
    WHERE state='trialing' AND applied_revision_id IS NOT NULL AND trial_ends_at IS NOT NULL AND trial_ends_at <= $1
      AND ($2::uuid IS NULL OR id=$2) ORDER BY id`, [input.now, input.subscription_id ?? null])).rows as { id: string }[]
  for (const { id } of due) {
    try {
      await transaction(pool, async client => {
        const row = (await client.query(`SELECT * FROM subscriptions WHERE id=$1 AND state='trialing' AND applied_revision_id IS NOT NULL
          AND trial_ends_at IS NOT NULL AND trial_ends_at <= $2 FOR UPDATE SKIP LOCKED`, [id, input.now])).rows[0]
        if (!row) return
        const snapshot = (await client.query('SELECT snapshot FROM subscription_revisions WHERE id=$1', [row.applied_revision_id])).rows[0].snapshot
        const free = input.convert ? null : await freeBaseOf(client, { subscription: row, snapshot })
        if (free) {
          if (row.target_revision_id) return
          if (await moveToFreeBase(client, { subscription: row, snapshot, free })) lapsed.push(id)
          return
        }
        await client.query("UPDATE subscriptions SET state='past_due',renewal_at=$2,revision=revision+1 WHERE id=$1", [id, riyadhDate(new Date(row.trial_ends_at))])
        expired.push(id)
      })
    } catch (error) { failures.push(error) }
  }
  const orders = expired.length ? await generateRenewals(pool, { now: input.now, adapter: input.adapter, returnOrigin: input.returnOrigin, subscription_id: input.subscription_id }) : []
  if (failures.length) throw failures[0]
  return { expired, lapsed, orders }
}
