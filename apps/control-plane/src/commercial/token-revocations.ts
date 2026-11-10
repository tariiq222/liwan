import type { Pool } from 'pg'
import { transaction } from '../db.js'
import type { PaymentAdapter } from './payment-adapter.js'

const BATCH = 20
const backoffMinutes = (attempts: number) => Math.min(2 ** attempts, 24 * 60)

/**
 * Tells the provider to forget stored payment methods that are no longer used (the customer turned auto-renew off, or a
 * new method replaced the old one). The row was written in the transaction that stopped using the method, and is deleted
 * only after the provider confirmed, so a crash or an outage leaves it for the next pass. A method with an unconfirmed charge on it is kept until that charge is settled. Rows of another provider wait
 * for their own adapter. A failure is logged without the token and backs off (1, 2, 4 ... minutes, at most a day).
 */
export async function processTokenRevocations(pool: Pool, adapter: PaymentAdapter, input: { log?: (message: string) => void } = {}): Promise<number> {
  if (!adapter.deleteToken) return 0
  return transaction(pool, async client => {
    const due = (await client.query(`SELECT r.id,r.token,r.attempts FROM token_revocations r WHERE provider=$1 AND next_attempt_at <= now()
      AND NOT EXISTS (SELECT 1 FROM payment_attempts a JOIN orders o ON o.id=a.order_id WHERE o.subscription_id=r.subscription_id AND a.token_charge AND a.status IN ('created','unknown'))
      ORDER BY r.next_attempt_at,r.id LIMIT $2 FOR UPDATE SKIP LOCKED`, [adapter.provider, BATCH])).rows as { id: string; token: string; attempts: number }[]
    for (const row of due) {
      try {
        await adapter.deleteToken!(row.token)
        await client.query('DELETE FROM token_revocations WHERE id=$1', [row.id])
      } catch {
        input.log?.(`[token-revocations] revocation ${row.id} failed; it will be retried`)
        await client.query("UPDATE token_revocations SET attempts=attempts+1,next_attempt_at=now()+make_interval(mins => $2::int) WHERE id=$1", [row.id, backoffMinutes(row.attempts + 1)])
      }
    }
    return due.length
  })
}
