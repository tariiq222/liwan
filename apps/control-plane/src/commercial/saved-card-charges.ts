import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { cardExpired, riyadhDate } from '@liwan/commercial-contracts'
import { transaction } from '../db.js'
import { deletionClockRunningSql } from './tenant-deletion-read.js'
import { holdsFreeBaseLockSql } from './free-base.js'
import { defaultPaymentMethod, type ActivePaymentMethodRow } from './payment-methods.js'
import { enqueueBillingNotice } from './billing-notices.js'
import { classifyDecline, type DeclineKind } from './payment-decline.js'
import { lookup, paymentReturnUrls } from './payments.js'
import { SAVED_CARD_CHARGE_DAYS, SAVED_CARD_REDRIVE_MINUTES } from './notice-timings.js'
import type { ChargeTokenOutcome, PaymentAdapter } from './payment-adapter.js'
import type { ReturnOrigin } from './return-origin.js'

const DECLINE_MESSAGE_MAX = 200
const LIVE = ['created', 'redirected', 'pending', 'unknown']
type Row = Record<string, any>

/** The day the n-th charge of an invoice (counting from 0) is due, or null when the schedule has no more. */
export function chargeDueOn(issuedOn: string, attemptsMade: number): string | null {
  const days = SAVED_CARD_CHARGE_DAYS[attemptsMade]
  return days === undefined ? null : new Date(Date.parse(`${issuedOn}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

type Plan =
  | { kind: 'skip' }
  | { kind: 'settle'; attempt: Row }
  | { kind: 'charge'; attemptId: string; attempt: Row; method: ActivePaymentMethodRow; amount: { minor: number; currency: string; exponent: number }; redrive: boolean }

/**
 * Decides, under the subscription row lock, whether this order's invoice is charged now, and reserves the attempt when it is. It repeats
 * everything renewal generation checks, then the card's own conditions; any failed condition means no charge and the invoice stays
 * payable by hand. The provider call happens after the commit and never holds the lock.
 */
async function planCharge(client: PoolClient, input: { order_id: string; subscription_id: string; now: Date; adapter: PaymentAdapter }): Promise<Plan> {
  const { now, adapter } = input
  const today = riyadhDate(now)
  const sub = (await client.query('SELECT * FROM subscriptions WHERE id=$1 FOR UPDATE', [input.subscription_id])).rows[0]
  if (!sub || !['active', 'past_due'].includes(sub.state) || sub.manual_suspension || !sub.applied_revision_id || sub.cancel_requested_at || sub.target_revision_id
    || !sub.auto_renew_enabled) return { kind: 'skip' }
  const blocked = (await client.query(`SELECT ${holdsFreeBaseLockSql('s')} AS lock,${deletionClockRunningSql('s.customer_id')} AS deleting FROM subscriptions s WHERE s.id=$1`, [sub.id])).rows[0]
  if (blocked.lock || blocked.deleting) return { kind: 'skip' }
  // An order being settled right now is not waited for (settlement takes the order before the subscription; waiting here would invert that): the next run tries again.
  const order = (await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE SKIP LOCKED', [input.order_id])).rows[0]
  const renewal = (await client.query('SELECT status,invoice_id FROM renewals WHERE order_id=$1', [input.order_id])).rows[0]
  if (!order || order.payment_state !== 'awaiting_payment' || order.cancelled || !renewal || ['paid', 'suspended', 'failed'].includes(renewal.status)) return { kind: 'skip' }
  const invoice = (await client.query("SELECT * FROM invoices WHERE id=$1 AND status='issued'", [renewal.invoice_id])).rows[0]
  if (!invoice || Number(invoice.total_minor) <= 0) return { kind: 'skip' }
  const method = await defaultPaymentMethod(client, sub.customer_id)
  if (!method || cardExpired(method, now)) return { kind: 'skip' }
  if (method.provider !== adapter.provider || method.mode !== adapter.mode) {
    // The card belongs to another provider or mode: it is no usable card here. Said once per card, never with the token.
    await client.query(`INSERT INTO audit_events(id,actor,action,subject,reason,metadata)
      SELECT $1,'system','payment.saved_card_unusable',$2,'The saved card belongs to another payment provider or mode; the invoice is payable by form',$3
      WHERE NOT EXISTS (SELECT 1 FROM audit_events WHERE action='payment.saved_card_unusable' AND subject=$2 AND metadata->>'payment_method_id'=$4)`,
    [randomUUID(), order.id, JSON.stringify({ payment_method_id: method.id, method_provider: method.provider, method_mode: method.mode, adapter_provider: adapter.provider, adapter_mode: adapter.mode }), method.id])
    return { kind: 'skip' }
  }
  const attempts = (await client.query('SELECT *,updated_at < now() - make_interval(mins => $2) AS stale FROM payment_attempts WHERE order_id=$1 ORDER BY created_at,id', [order.id, SAVED_CARD_REDRIVE_MINUTES])).rows as Row[]
  const live = attempts.filter(a => LIVE.includes(a.status))
  // A customer in the middle of paying by form, or a hosted link a vendor issued, is never charged on top of.
  if (live.some(a => a.kind !== 'saved_card')) return { kind: 'skip' }
  const amount = { minor: Number(invoice.total_minor), currency: invoice.currency as string, exponent: invoice.exponent as number }
  const open = live[0]
  if (open) {
    if (open.status === 'pending') return { kind: 'settle', attempt: open }
    // A charge whose answer was lost keeps its attempt: it is looked up by its id and, when the provider has none, sent again with the same id.
    if (!open.stale) return { kind: 'skip' }
    return { kind: 'charge', attemptId: open.id, attempt: open, method, amount, redrive: true }
  }
  const made = attempts.filter(a => a.kind === 'saved_card').length
  const dueOn = chargeDueOn(riyadhDate(invoice.created_at), made)
  if (dueOn === null || today < dueOn) return { kind: 'skip' }
  const attemptId = randomUUID()
  // The attempt's id is the provider's idempotency key and, at the provider, the payment's id: a lost answer is found again by it.
  const attempt = (await client.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,merchant_ref,provider_ref,amount_minor,currency,exponent,kind)
    VALUES($1,$2,$3,$4,$5,$2::uuid::text,$1::uuid::text,$6,$7,$8,'saved_card') RETURNING *`,
  [attemptId, order.id, invoice.id, adapter.provider, adapter.mode, amount.minor, amount.currency, amount.exponent])).rows[0]
  await client.query("UPDATE renewals SET status='charging' WHERE order_id=$1 AND status IN ('invoiced','past_due')", [order.id])
  return { kind: 'charge', attemptId, attempt, method, amount, redrive: false }
}

/**
 * The one place a saved card is charged, for the first try on the invoice day and for every retry. Each due renewal invoice with
 * automatic renewal on is planned under its subscription lock (`planCharge`) and charged after the commit. A failure of one invoice is
 * logged and never stops the others.
 */
export async function chargeSavedCards(pool: Pool, { now = new Date(), adapter, returnOrigin, subscription_id }: {
  now?: Date; adapter: PaymentAdapter; returnOrigin: ReturnOrigin; subscription_id?: string
}): Promise<{ charged: number; failed: number }> {
  const candidates = (await pool.query(`SELECT r.order_id,r.subscription_id,s.customer_id FROM renewals r
    JOIN orders o ON o.id=r.order_id JOIN invoices i ON i.id=r.invoice_id JOIN subscriptions s ON s.id=r.subscription_id
    WHERE r.status IN ('invoiced','charging','past_due') AND o.payment_state='awaiting_payment' AND NOT o.cancelled AND i.status='issued'
      AND s.auto_renew_enabled AND ($1::uuid IS NULL OR s.id=$1) ORDER BY o.created_at,o.id`, [subscription_id ?? null])).rows as Row[]
  let charged = 0, failed = 0
  for (const candidate of candidates) {
    try {
      const origin = await returnOrigin(candidate.customer_id)
      const plan = await transaction(pool, client => planCharge(client, { order_id: candidate.order_id, subscription_id: candidate.subscription_id, now, adapter }))
      if (plan.kind === 'skip') continue
      if (plan.kind === 'settle') { await lookup(pool, adapter, plan.attempt); continue }
      if (plan.redrive && await settledByLookup(pool, adapter, plan.attempt)) continue
      await chargeSavedCard(pool, adapter, { attemptId: plan.attemptId, order_id: candidate.order_id, subscription_id: candidate.subscription_id, method: plan.method,
        amount: plan.amount, callback_url: paymentReturnUrls(origin, plan.attemptId) })
      charged++
    } catch (error) {
      failed++
      console.error(JSON.stringify({ event: 'commercial_saved_card_charge_skipped', order_id: candidate.order_id, error: (error as { code?: string })?.code ?? 'error' }))
    }
  }
  return { charged, failed }
}

/** Asks the provider for the payment of an attempt whose answer was lost, by the attempt id. True when the provider knew it (the lookup then settled or closed it). */
async function settledByLookup(pool: Pool, adapter: PaymentAdapter, attempt: Row): Promise<boolean> {
  try { await lookup(pool, adapter, attempt); return true }
  catch (error) {
    const code = (error as { code?: string })?.code
    if (code !== 'not_found' && code !== 'payment_unknown') console.error(JSON.stringify({ event: 'commercial_saved_card_lookup_failed', attempt_id: attempt.id, error: code ?? 'error' }))
    return false
  }
}

type CloseInput = { attemptId: string; order_id: string; subscription_id: string; action: string; reason: string; metadata: Record<string, unknown>; decline: DeclineKind; methodId: string }

/**
 * Closes a saved-card attempt as failed, puts the renewal back to invoiced, records why (never the token or a provider URL) and tells the
 * customer. A hard decline marks the card inactive, so nothing charges it again; a soft one leaves the next day of the schedule. Returns whether it closed.
 */
async function closeChargeAttempt(pool: Pool, input: CloseInput): Promise<boolean> {
  return transaction(pool, async client => {
    const closed = await client.query("UPDATE payment_attempts SET status='failed',updated_at=now() WHERE id=$1 AND status IN ('created','unknown') RETURNING invoice_id", [input.attemptId])
    if (!closed.rowCount) return false
    await client.query("UPDATE renewals SET status='invoiced' WHERE order_id=$1 AND status='charging'", [input.order_id])
    if (input.decline === 'hard') await client.query("UPDATE payment_methods SET status='inactive' WHERE id=$1 AND status='active'", [input.methodId])
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), 'system', input.action, input.order_id, input.reason, JSON.stringify({ attempt_id: input.attemptId, decline: input.decline, ...input.metadata })])
    const invoice = (await client.query('SELECT created_at FROM invoices WHERE id=$1', [closed.rows[0].invoice_id])).rows[0]
    const made = (await client.query("SELECT count(*)::int AS n FROM payment_attempts WHERE order_id=$1 AND kind='saved_card'", [input.order_id])).rows[0].n as number
    const retryOn = input.decline === 'soft' ? chargeDueOn(riyadhDate(invoice.created_at), made) : null
    await enqueueBillingNotice(client, `card_charge_failed:${input.attemptId}`,
      { type: 'card_charge_failed', subscription_id: input.subscription_id, invoice_id: closed.rows[0].invoice_id, ...(retryOn ? { retry_on: retryOn } : {}) })
    return true
  })
}

/** Parks the attempt as unknown: the charge may have happened, so the reconciler looks the payment up by the attempt id and nothing is retried blindly. */
const parkUnknown = (pool: Pool, attemptId: string) =>
  pool.query("UPDATE payment_attempts SET status='unknown',updated_at=now() WHERE id=$1 AND status IN ('created','pending')", [attemptId])

/**
 * Charges the saved card and acts on each of the five outcomes. `paid` and `unknown` leave the attempt live for settlement or the
 * reconciler; every other outcome closes it as failed at once. A thrown `used_given_id` means an earlier call of this attempt reached
 * the provider: the payment is looked up by the attempt id.
 */
async function chargeSavedCard(pool: Pool, adapter: PaymentAdapter, input: { attemptId: string; order_id: string; subscription_id: string; method: { id: string; provider_token: string }
  amount: Parameters<PaymentAdapter['chargeToken']>[0]['amount']; callback_url: string }): Promise<void> {
  const { attemptId, order_id, subscription_id } = input
  const close = (action: string, reason: string, decline: DeclineKind, metadata: Record<string, unknown>) =>
    closeChargeAttempt(pool, { attemptId, order_id, subscription_id, action, reason, metadata, decline, methodId: input.method.id })
  let charged: ChargeTokenOutcome
  try {
    charged = await adapter.chargeToken({ given_id: attemptId, token: input.method.provider_token, amount: input.amount,
      description: `LiwanOS renewal ${order_id}`, callback_url: input.callback_url })
  } catch (error) {
    const code = (error as { code?: string })?.code ?? 'error'
    if (code === 'used_given_id') {
      await pool.query("UPDATE payment_attempts SET status='pending',updated_at=now() WHERE id=$1 AND status IN ('created','unknown')", [attemptId])
      try { await lookup(pool, adapter, (await pool.query('SELECT * FROM payment_attempts WHERE id=$1', [attemptId])).rows[0]) }
      catch { await parkUnknown(pool, attemptId) }
      return
    }
    console.error(JSON.stringify({ event: 'commercial_saved_card_charge_failed', attempt_id: attemptId, error: code }))
    await parkUnknown(pool, attemptId)
    return
  }
  switch (charged.outcome) {
    case 'paid':
      // A charge response only identifies the payment; settlement requires the provider lookup.
      await pool.query("UPDATE payment_attempts SET provider_ref=$2,status=CASE WHEN status IN ('created','unknown') THEN 'pending' ELSE status END,updated_at=now() WHERE id=$1", [attemptId, charged.payment.payment_id])
      return
    case 'declined':
      await close('payment.saved_card_declined', 'The provider declined the saved card', classifyDecline(charged.message), { message: charged.message?.slice(0, DECLINE_MESSAGE_MAX) ?? null })
      return
    case 'needs_customer_action':
      await close('payment.saved_card_needs_customer_action', 'The saved card needs the customer to act (authentication); it cannot be charged in the background', 'hard', {})
      return
    case 'token_unusable':
      await close('payment.saved_card_unusable', 'The provider refused the saved card; it is marked inactive', 'hard', { payment_method_id: input.method.id })
      return
    case 'unknown':
      await parkUnknown(pool, attemptId)
      return
    default: { const exhausted: never = charged; throw new Error(`unhandled charge outcome ${JSON.stringify(exhausted)}`) }
  }
}
