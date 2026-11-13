import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { transaction } from '../db.js'
import type { WebhookVerification } from './payment-adapter.js'

/** The audit action of a webhook registration code: the durable fact the vendor alert scan reads (vendor-alerts.ts), so the code reaches the operator. */
export const WEBHOOK_VERIFICATION_ACTION = 'payment.webhook_verification'
/**
 * While the operator has opened registration, an event without the shared secret cannot be told from a stranger's request, and a wrong
 * code the operator types counts against the provider's lock (five tries). So at most this many unsigned codes are recorded per hour;
 * a signed event is never limited.
 */
export const UNSIGNED_PER_HOUR = 10
const LOCK_KEY = `commercial-webhook-verification`

export type VerificationRecording = 'recorded' | 'duplicate' | 'throttled'

/**
 * Records the provider's one-time webhook registration code for the operator: a log line, an audit event and (through the vendor alert
 * scan) an alert. It changes no payment, order or customer state, and the code is never part of an answer to the caller. One transaction
 * under an advisory lock checks the duplicate and the bound and inserts, so concurrent events cannot exceed the bound. The same
 * webhook and code is a no-op; an unsigned event over the bound is `throttled` (the route answers 429, so the provider retries or the
 * operator sees the refusal) and nothing is recorded.
 */
export async function recordWebhookVerification(pool: Pool, verification: WebhookVerification): Promise<VerificationRecording> {
  const { webhook_id: webhookId, code, authenticated } = verification
  const result = await transaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [LOCK_KEY])
    if ((await client.query(`SELECT 1 FROM audit_events WHERE action='${WEBHOOK_VERIFICATION_ACTION}' AND subject=$1 AND metadata->>'code'=$2`, [webhookId, code])).rowCount) return 'duplicate' as const
    if (!authenticated && (await client.query(`SELECT count(*)::int AS n FROM audit_events WHERE action='${WEBHOOK_VERIFICATION_ACTION}'
      AND metadata->>'authenticated'='false' AND created_at > now() - interval '1 hour'`)).rows[0].n >= UNSIGNED_PER_HOUR) return 'throttled' as const
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), 'system', WEBHOOK_VERIFICATION_ACTION, webhookId, 'The payment provider sent its webhook registration code',
        JSON.stringify({ webhook_id: webhookId, code, authenticated, occurred_at: verification.occurred_at })])
    return 'recorded' as const
  })
  if (result === 'throttled') console.error(JSON.stringify({ event: 'payment_webhook_verification_throttled', webhook_id: webhookId }))
  if (result === 'recorded') console.error(JSON.stringify({ event: 'payment_webhook_verification', webhook_id: webhookId, code, authenticated }))
  return result
}
