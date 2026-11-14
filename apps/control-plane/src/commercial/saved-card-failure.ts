import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { enqueueBillingNotice } from './billing-notices.js'
import { classifyDecline, type DeclineKind } from './payment-decline.js'
import { LIVE_ATTEMPT_STATUSES } from './form-payments.js'

const MESSAGE_MAX = 200

type Closed = { action: string; reason: string }
const DECLINED: Closed = { action: 'payment.saved_card_declined', reason: 'The provider declined the saved card' }

/**
 * The one way a saved-card attempt ends as failed, however it was learned: the provider's answer to the charge, a lookup after a lost
 * answer, the reconciler, or a webhook. It closes the attempt, puts the renewal back to invoiced, classifies the decline by the provider's
 * message, marks the card it charged inactive on a hard decline, records why (never the token or a provider URL) and queues one
 * `card_charge_failed` notice for this attempt. A hard decline replaces the notices of the same invoice that have not gone out yet, so the
 * customer reads one. Returns false when the attempt was already closed (a replayed event changes nothing).
 */
export async function failSavedCardAttempt(client: Pick<PoolClient, 'query'>, input: { attempt_id: string; message?: string | null; hard?: boolean; closed?: Closed; metadata?: Record<string, unknown> }): Promise<boolean> {
  const attempt = (await client.query(`UPDATE payment_attempts SET status='failed',updated_at=now() WHERE id=$1 AND kind='saved_card' AND status = ANY($2::text[]) RETURNING *`,
    [input.attempt_id, LIVE_ATTEMPT_STATUSES])).rows[0]
  if (!attempt) return false
  const decline: DeclineKind = input.hard ? 'hard' : classifyDecline(input.message)
  const order = (await client.query('SELECT subscription_id FROM orders WHERE id=$1', [attempt.order_id])).rows[0]
  await client.query("UPDATE renewals SET status='invoiced' WHERE order_id=$1 AND status='charging'", [attempt.order_id])
  if (decline === 'hard' && attempt.payment_method_id)
    await client.query("UPDATE payment_methods SET status='inactive' WHERE id=$1 AND status='active'", [attempt.payment_method_id])
  const closed = input.closed ?? DECLINED
  await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(), 'system', closed.action, attempt.order_id, closed.reason,
      JSON.stringify({ attempt_id: attempt.id, decline, message: input.message?.slice(0, MESSAGE_MAX) ?? null, ...input.metadata })])
  const key = `card_charge_failed:${attempt.id}`
  if (decline === 'hard') await client.query(`UPDATE commercial_outbox SET status='done',processed_at=now() WHERE kind='billing.notice' AND status='pending'
    AND aggregate_id=$1 AND payload->>'type'='card_charge_failed' AND payload->>'invoice_id'=$2 AND dedupe_key<>$3`, [order.subscription_id, attempt.invoice_id, key])
  await enqueueBillingNotice(client, key, { type: 'card_charge_failed', subscription_id: order.subscription_id, invoice_id: attempt.invoice_id, decline })
  return true
}

/**
 * A charge the provider refused for a reason that will not pass by itself (a malformed request, a refused key, an unusable configuration):
 * the attempt closes as failed without a decline mark and the card stays as it is. The vendor sees it (an attention item, derived from this
 * audit row while the order is unpaid) and the customer is told the invoice must be paid by hand. The schedule still bounds the tries.
 */
export async function refuseSavedCardAttempt(client: Pick<PoolClient, 'query'>, input: { attempt_id: string; code: string }): Promise<boolean> {
  const attempt = (await client.query(`UPDATE payment_attempts SET status='failed',updated_at=now() WHERE id=$1 AND kind='saved_card' AND status = ANY($2::text[]) RETURNING *`,
    [input.attempt_id, LIVE_ATTEMPT_STATUSES])).rows[0]
  if (!attempt) return false
  const order = (await client.query('SELECT subscription_id FROM orders WHERE id=$1', [attempt.order_id])).rows[0]
  await client.query("UPDATE renewals SET status='invoiced' WHERE order_id=$1 AND status='charging'", [attempt.order_id])
  await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(), 'system', 'payment.saved_card_charge_refused', attempt.order_id, 'The provider refused the charge request itself; it is not retried until the cause is fixed',
      JSON.stringify({ attempt_id: attempt.id, code: input.code.slice(0, 80) })])
  await enqueueBillingNotice(client, `card_charge_skipped:${attempt.invoice_id}`, { type: 'card_charge_skipped', subscription_id: order.subscription_id, invoice_id: attempt.invoice_id, skip_reason: 'charge_refused' })
  return true
}
