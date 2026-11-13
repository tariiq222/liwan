import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import type { WebhookVerification } from './payment-adapter.js'

/** The audit action of a webhook registration code: the durable fact the vendor alert scan reads (vendor-alerts.ts), so the code reaches the operator. */
export const WEBHOOK_VERIFICATION_ACTION = 'payment.webhook_verification'
/**
 * A registration event that does not carry the shared secret cannot be told from a stranger's request, and a wrong code the operator
 * types counts against the provider's lock (five tries). So at most this many unauthenticated codes are recorded per hour; authenticated
 * ones are never limited.
 */
export const UNAUTHENTICATED_PER_HOUR = 3

export type VerificationRecording = 'recorded' | 'duplicate' | 'throttled'

/**
 * Records the provider's one-time webhook registration code for the operator: a log line, an audit event and (through the vendor alert
 * scan) an alert. It changes no payment, order or customer state, and the code is never part of an answer to the caller. The same
 * webhook and code is recorded once.
 */
export async function recordWebhookVerification(pool: Pool, verification: WebhookVerification): Promise<VerificationRecording> {
  const { webhook_id: webhookId, code, authenticated } = verification
  if ((await pool.query("SELECT 1 FROM audit_events WHERE action=$1 AND subject=$2 AND metadata->>'code'=$3", [WEBHOOK_VERIFICATION_ACTION, webhookId, code])).rowCount) return 'duplicate'
  if (!authenticated && (await pool.query(`SELECT count(*)::int AS n FROM audit_events WHERE action=$1 AND metadata->>'authenticated'='false'
    AND created_at > now() - interval '1 hour'`, [WEBHOOK_VERIFICATION_ACTION])).rows[0].n >= UNAUTHENTICATED_PER_HOUR) {
    console.error(JSON.stringify({ event: 'payment_webhook_verification_throttled', webhook_id: webhookId }))
    return 'throttled'
  }
  console.error(JSON.stringify({ event: 'payment_webhook_verification', webhook_id: webhookId, code, authenticated }))
  await pool.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(), 'system', WEBHOOK_VERIFICATION_ACTION, webhookId, 'The payment provider sent its webhook registration code',
      JSON.stringify({ code, authenticated, occurred_at: verification.occurred_at })])
  return 'recorded'
}
