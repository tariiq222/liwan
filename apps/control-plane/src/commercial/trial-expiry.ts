import type { Pool } from 'pg'
import { riyadhDate } from '@liwan/commercial-contracts'
import { transaction } from '../db.js'
import { generateRenewals } from './renewals.js'
import type { ReturnOrigin } from './return-origin.js'
import type { PaymentAdapter } from './payment-adapter.js'

/**
 * Ends every trial that reached its end date and whose workspace is active (a trial still waiting for
 * activation has no applied snapshot to invoice from, so it ends once that applies). The subscription moves to past_due first, then the
 * existing renewal path issues the first invoice and a hosted payment attempt; the renewals unique
 * key keeps a repeated run from issuing a second invoice. Ending the trial never depends on the invoice: a customer
 * without a usable return origin still leaves `trialing`, is marked billing-blocked (the vendor attention list shows
 * it) and is invoiced by a later run once its origin is fixed; the run then fails with `return_url_forbidden` so
 * the block is never silent.
 */
export async function expireTrials(pool: Pool, input: { now: Date; adapter: PaymentAdapter; returnOrigin: ReturnOrigin; subscription_id?: string }) {
  const expired: string[] = []
  await transaction(pool, async client => {
    const due = (await client.query(`SELECT id,customer_id,trial_ends_at FROM subscriptions
      WHERE state='trialing' AND applied_revision_id IS NOT NULL AND trial_ends_at IS NOT NULL AND trial_ends_at <= $1
        AND ($2::uuid IS NULL OR id=$2)
      ORDER BY id FOR UPDATE SKIP LOCKED`, [input.now, input.subscription_id ?? null])).rows
    for (const row of due) {
      await client.query("UPDATE subscriptions SET state='past_due',renewal_at=$2,revision=revision+1 WHERE id=$1", [row.id, riyadhDate(new Date(row.trial_ends_at))])
      expired.push(row.id)
    }
  })
  const orders = expired.length ? await generateRenewals(pool, { now: input.now, adapter: input.adapter, returnOrigin: input.returnOrigin, subscription_id: input.subscription_id }) : []
  return { expired, orders }
}
