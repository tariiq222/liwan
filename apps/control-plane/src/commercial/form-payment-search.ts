// Finding the payment of a card form attempt that never reported back (no webhook, no return). The page puts the attempt id in the payment's
// `metadata`, and the provider can list payments by a metadata key. That metadata is set by the browser, so it proves nothing: the search only
// names candidates, and every candidate goes through `resolveFormPayment` (fetched with the secret key, intent fulfilled, description, amount,
// currency, the locked callback with its secret). A candidate that fails there is a rejected payment like any other.
import type { Pool } from 'pg'
import { logCode } from '../log-text.js'
import { transaction } from '../db.js'
import type { PaymentAdapter } from './payment-adapter.js'
import { resolveFormPayment, type SettleInTransaction } from './form-payments.js'

type Row = Record<string, any>

export const FORM_PAYMENT_SEARCH_ACTION = 'payment.form_payment_searched'
/** The most searches one attempt ever gets, and the least time between two of them (the one at the end of its lifetime ignores the gap). */
export const FORM_SEARCH_MAX_PER_ATTEMPT = 4
export const FORM_SEARCH_MIN_GAP_MINUTES = 15
/** A payment still `initiated` fails by itself after about 15 minutes, so a search before this age could only find a payment still in progress. */
export const FORM_SEARCH_MIN_AGE_MS = 16 * 60_000
/** The provider's clock and ours differ a little: the creation window is the attempt's life widened by this much on both sides. */
const WINDOW_SLACK_MS = 5 * 60_000

export type FormSearchOutcome = 'settled' | 'declined' | 'none' | 'skipped'

/**
 * One bounded search for the payment of an attempt that has none on record. The search is claimed first, as a row in the audit log, so a
 * run that fails still uses its turn and an attempt can never be searched more than `FORM_SEARCH_MAX_PER_ATTEMPT` times. A paid candidate that
 * verifies is settled; when only failed candidates verify the decline is recorded (the customer may start again at once); otherwise
 * nothing changes. A provider error leaves the attempt as it was and is logged by code.
 */
export async function searchUnreportedFormPayment(pool: Pool, adapter: PaymentAdapter, attempt: Row, settle: SettleInTransaction, options: { ignoreGap?: boolean } = {}): Promise<FormSearchOutcome> {
  if (attempt.kind !== 'form' || attempt.provider_ref || attempt.provider !== adapter.provider || attempt.mode !== adapter.mode) return 'skipped'
  if (!(await claimSearch(pool, attempt, options.ignoreGap === true))) return 'skipped'
  const created = new Date(attempt.created_at).getTime()
  let outcome: FormSearchOutcome = 'none'
  try {
    const found = await adapter.listPaymentsByAttempt(attempt.id, { from: new Date(created - WINDOW_SLACK_MS), to: new Date(Date.now() + WINDOW_SLACK_MS) })
    for (const payment_id of found.payment_ids) {
      const resolved = await resolveFormPayment(pool, adapter, { payment_id, source: 'search', expect: attempt, settle })
      if (resolved.outcome === 'settled') return 'settled'
      if (resolved.outcome === 'declined') outcome = 'declined'
    }
  } catch (error) {
    console.error('[payments] the search for the payment of attempt %s failed (%s)', attempt.id, logCode(error))
  }
  return outcome
}

/** Takes one of the attempt's searches, or says there is none left (or the last was too recent). Counting and inserting are one statement. */
async function claimSearch(pool: Pool, attempt: Row, ignoreGap: boolean): Promise<boolean> {
  const claimed = await transaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`form-payment-search:${attempt.id}`])
    return client.query(`INSERT INTO audit_events(id,actor,action,subject,reason,metadata)
    SELECT gen_random_uuid(),'system',$1,$2,'Searched the provider for a card form payment that was never reported',jsonb_build_object('attempt_id',$2::text)
    WHERE (SELECT count(*) FROM audit_events WHERE action=$1 AND subject=$2) < $3
      AND ($4 OR NOT EXISTS (SELECT 1 FROM audit_events WHERE action=$1 AND subject=$2 AND created_at > now() - make_interval(mins => $5)))
    RETURNING id`, [FORM_PAYMENT_SEARCH_ACTION, attempt.id, FORM_SEARCH_MAX_PER_ATTEMPT, ignoreGap, FORM_SEARCH_MIN_GAP_MINUTES])
  })
  return (claimed.rowCount ?? 0) > 0
}
