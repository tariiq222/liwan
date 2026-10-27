import type { Pool } from 'pg'
import { riyadhDate } from '@webvue/commercial-contracts'
import { transaction } from '../db.js'
import { generateRenewals } from './renewals.js'
import type { PaymentAdapter } from './payment-adapter.js'

/**
 * Ends every trial that reached its end date. The subscription moves to past_due first, then the
 * existing renewal path issues the first invoice and a hosted payment attempt; the renewals unique
 * key keeps a repeated run from issuing a second invoice.
 */
export async function expireTrials(pool: Pool, input: { now: Date; adapter: PaymentAdapter; allowedOrigin: string; subscription_id?: string }) {
  const expired: string[] = []
  await transaction(pool, async client => {
    const due = (await client.query(`SELECT id,trial_ends_at FROM subscriptions
      WHERE state='trialing' AND trial_ends_at IS NOT NULL AND trial_ends_at <= $1
        AND ($2::uuid IS NULL OR id=$2)
      ORDER BY id FOR UPDATE SKIP LOCKED`, [input.now, input.subscription_id ?? null])).rows
    for (const row of due) {
      await client.query("UPDATE subscriptions SET state='past_due',renewal_at=$2,revision=revision+1 WHERE id=$1", [row.id, riyadhDate(new Date(row.trial_ends_at))])
      expired.push(row.id)
    }
  })
  const orders = expired.length ? await generateRenewals(pool, { now: input.now, adapter: input.adapter, allowedOrigin: input.allowedOrigin }) : []
  return { expired, orders }
}
