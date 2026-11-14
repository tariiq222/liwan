import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { cardExpired, riyadhDate } from '@liwan/commercial-contracts'
import { transaction } from '../db.js'
import { deletionClockRunningSql } from './tenant-deletion-read.js'
import { holdsFreeBaseLockSql } from './free-base.js'
import { defaultPaymentMethod, type ActivePaymentMethodRow } from './payment-methods.js'
import { enqueueBillingNotice, type SkipReason } from './billing-notices.js'
import { failSavedCardAttempt, refuseSavedCardAttempt } from './saved-card-failure.js'
import { LIVE_ATTEMPT_STATUSES } from './form-payments.js'
import { lookup, paymentReturnUrls } from './payments.js'
import { SAVED_CARD_CHARGE_DAYS, SAVED_CARD_REDRIVE_MINUTES, chargeDueOn } from './notice-timings.js'
import { MIN_CHARGE_MINOR, PaymentError, type ChargeTokenOutcome, type PaymentAdapter } from './payment-adapter.js'
import type { ReturnOrigin } from './return-origin.js'

type Row = Record<string, any>
type Money = { minor: number; currency: string; exponent: number }

type Plan =
  | { kind: 'skip' }
  | { kind: 'settle'; attempt: Row }
  | { kind: 'charge'; attemptId: string; method: ActivePaymentMethodRow; amount: Money; callback_url: string; redrive: boolean; attempt: Row }

/** Tells the customer, once per invoice and only before any charge was made for it, that this invoice is paid by hand and why. */
const noteSkip = (client: PoolClient, subscriptionId: string, invoiceId: string, made: number, reason: SkipReason) =>
  made === 0 ? enqueueBillingNotice(client, `card_charge_skipped:${invoiceId}`, { type: 'card_charge_skipped', subscription_id: subscriptionId, invoice_id: invoiceId, skip_reason: reason }) : Promise.resolve(false)

/**
 * Decides, under the subscription row lock, whether this order's invoice is charged now, and reserves the attempt when it is. It repeats
 * everything renewal generation checks, then the card's own conditions; any failed condition means no charge and the invoice stays
 * payable by hand (a skip that breaks a promise of automatic charging is told to the customer once). The provider call happens after the
 * commit and never holds the lock. The return origin is asked for only when a charge is about to be made, and a customer without a usable
 * one is flagged to the vendor exactly as renewal generation flags it.
 */
async function planCharge(client: PoolClient, input: { order_id: string; subscription_id: string; now: Date; adapter: PaymentAdapter; returnOrigin: ReturnOrigin }): Promise<Plan> {
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
  if (!order || order.payment_state !== 'awaiting_payment' || order.cancelled || !renewal || !['invoiced', 'charging', 'past_due'].includes(renewal.status)) return { kind: 'skip' }
  const invoice = (await client.query("SELECT * FROM invoices WHERE id=$1 AND status='issued'", [renewal.invoice_id])).rows[0]
  if (!invoice || Number(invoice.total_minor) <= 0) return { kind: 'skip' }
  const attempts = (await client.query('SELECT *,COALESCE(charge_sent_at,created_at) < now() - make_interval(mins => $2) AS stale FROM payment_attempts WHERE order_id=$1 ORDER BY created_at,id',
    [order.id, SAVED_CARD_REDRIVE_MINUTES])).rows as Row[]
  const live = attempts.filter(a => (LIVE_ATTEMPT_STATUSES as readonly string[]).includes(a.status))
  const made = attempts.filter(a => a.kind === 'saved_card').length
  // A customer in the middle of paying by form, or a hosted link a vendor issued, is never charged on top of.
  if (live.some(a => a.kind !== 'saved_card')) return { kind: 'skip' }
  // A card form attempt closed while its payment may still arrive holds the invoice until that payment is settled or declined, the hold runs out, or the order is paid or cancelled.
  if (attempts.some(a => a.kind === 'form' && a.payment_hold_until && new Date(a.payment_hold_until) > now && !a.provider_ref && !a.declined_payment_ref)) return { kind: 'skip' }
  const plan = (await client.query(`SELECT p.auto_renew_allowed FROM subscription_revisions r JOIN plan_revisions p ON p.id::text = r.snapshot->>'plan_revision_id' WHERE r.id=$1`, [sub.applied_revision_id])).rows[0]
  if (!plan?.auto_renew_allowed) { await noteSkip(client, sub.id, invoice.id, made, 'plan_not_allowed'); return { kind: 'skip' } }
  const amount: Money = { minor: Number(invoice.total_minor), currency: invoice.currency, exponent: invoice.exponent }
  if (amount.minor < MIN_CHARGE_MINOR) { await noteSkip(client, sub.id, invoice.id, made, 'amount_below_minimum'); return { kind: 'skip' } }
  const method = await defaultPaymentMethod(client, sub.customer_id)
  if (!method || cardExpired(method, now)) { await noteSkip(client, sub.id, invoice.id, made, 'card_unusable'); return { kind: 'skip' } }
  if (method.provider !== adapter.provider || method.mode !== adapter.mode) {
    // The card belongs to another provider or mode: it is no usable card here. Said once per card, never with the token.
    await client.query(`INSERT INTO audit_events(id,actor,action,subject,reason,metadata)
      SELECT $1,'system','payment.saved_card_unusable',$2,'The saved card belongs to another payment provider or mode; the invoice is payable by form',$3
      WHERE NOT EXISTS (SELECT 1 FROM audit_events WHERE action='payment.saved_card_unusable' AND subject=$2 AND metadata->>'payment_method_id'=$4)`,
    [randomUUID(), order.id, JSON.stringify({ payment_method_id: method.id, method_provider: method.provider, method_mode: method.mode, adapter_provider: adapter.provider, adapter_mode: adapter.mode }), method.id])
    await noteSkip(client, sub.id, invoice.id, made, 'card_unusable')
    return { kind: 'skip' }
  }
  const open = live[0]
  if (open?.status === 'pending') return { kind: 'settle', attempt: open }
  if (open && !open.stale) return { kind: 'skip' }
  if (!open) {
    const dueOn = chargeDueOn(riyadhDate(invoice.created_at), made)
    if (dueOn === null || today < dueOn) return { kind: 'skip' }
  }
  const attemptId: string = open?.id ?? randomUUID()
  let callback_url: string
  try { callback_url = paymentReturnUrls(await input.returnOrigin(sub.customer_id), attemptId) }
  catch (error) {
    if ((error as { code?: string })?.code !== 'return_url_forbidden') throw error
    await client.query('UPDATE subscriptions SET billing_blocked_at=COALESCE(billing_blocked_at,now()) WHERE id=$1', [sub.id])
    return { kind: 'skip' }
  }
  if (open) {
    await client.query('UPDATE payment_attempts SET charge_sent_at=now() WHERE id=$1', [open.id])
    return { kind: 'charge', attemptId, attempt: open, method, amount, callback_url, redrive: true }
  }
  // The attempt's id is the provider's idempotency key and, at the provider, the payment's id: a lost answer is found again by it.
  const attempt = (await client.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,merchant_ref,provider_ref,amount_minor,currency,exponent,kind,payment_method_id,charge_sent_at)
    VALUES($1,$2,$3,$4,$5,$2::uuid::text,$1::uuid::text,$6,$7,$8,'saved_card',$9,now()) RETURNING *`,
  [attemptId, order.id, invoice.id, adapter.provider, adapter.mode, amount.minor, amount.currency, amount.exponent, method.id])).rows[0]
  await client.query("UPDATE renewals SET status='charging' WHERE order_id=$1 AND status IN ('invoiced','past_due')", [order.id])
  return { kind: 'charge', attemptId, attempt, method, amount, callback_url, redrive: false }
}

/**
 * The one place a saved card is charged, for the first try on the invoice day and for every retry. Each due renewal invoice with
 * automatic renewal on is planned under its subscription lock (`planCharge`) and charged after the commit. A failure of one invoice is
 * logged and never stops the others. An invoice whose tries are used up is not planned again.
 */
export async function chargeSavedCards(pool: Pool, { now = new Date(), adapter, returnOrigin, subscription_id }: {
  now?: Date; adapter: PaymentAdapter; returnOrigin: ReturnOrigin; subscription_id?: string
}): Promise<{ charged: number; failed: number }> {
  const candidates = (await pool.query(`SELECT r.order_id,r.subscription_id FROM renewals r
    JOIN orders o ON o.id=r.order_id JOIN invoices i ON i.id=r.invoice_id JOIN subscriptions s ON s.id=r.subscription_id
    WHERE r.status IN ('invoiced','charging','past_due') AND o.payment_state='awaiting_payment' AND NOT o.cancelled AND i.status='issued'
      AND s.auto_renew_enabled AND ($1::uuid IS NULL OR s.id=$1)
      AND (EXISTS (SELECT 1 FROM payment_attempts a WHERE a.order_id=o.id AND a.status = ANY($2::text[]))
        OR (SELECT count(*) FROM payment_attempts a WHERE a.order_id=o.id AND a.kind='saved_card') < $3)
    ORDER BY o.created_at,o.id`, [subscription_id ?? null, LIVE_ATTEMPT_STATUSES, SAVED_CARD_CHARGE_DAYS.length])).rows as Row[]
  let charged = 0, failed = 0
  for (const candidate of candidates) {
    try {
      const plan = await transaction(pool, client => planCharge(client, { order_id: candidate.order_id, subscription_id: candidate.subscription_id, now, adapter, returnOrigin }))
      if (plan.kind === 'skip') continue
      if (plan.kind === 'settle') { await lookup(pool, adapter, plan.attempt); continue }
      if (plan.redrive && await settledByLookup(pool, adapter, plan.attempt)) continue
      await chargeSavedCard(pool, adapter, { attemptId: plan.attemptId, order_id: candidate.order_id, method: plan.method, amount: plan.amount, callback_url: plan.callback_url })
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

/** Parks the attempt as unknown: the charge may have happened, so the reconciler looks the payment up by the attempt id and nothing is retried blindly. */
const parkUnknown = (pool: Pool, attemptId: string) =>
  pool.query("UPDATE payment_attempts SET status='unknown',updated_at=now() WHERE id=$1 AND status IN ('created','pending')", [attemptId])

/** A thrown error that says nothing about whether the charge reached the provider and will pass by itself: the network, a 5xx, a rate limit. Anything else is the request's own fault. */
function transient(error: unknown): boolean {
  if (!(error instanceof PaymentError)) return false
  return error.code === 'timeout' || error.code === 'provider_unreachable' || (error.httpStatus !== undefined && (error.httpStatus >= 500 || error.httpStatus === 429))
}

const closeWith = <T>(pool: Pool, work: (client: PoolClient) => Promise<T>) => transaction(pool, work)

/**
 * Charges the saved card and acts on each of the five outcomes. `paid` and `unknown` leave the attempt live for settlement or the
 * reconciler; every other outcome closes it as failed at once through the one failure function. A thrown `used_given_id` means an earlier
 * call of this attempt reached the provider: the payment is looked up by the attempt id. Any other thrown error that is not transient is
 * the request's own fault: the attempt is closed and the vendor sees it, instead of being parked and looked up for ever.
 */
async function chargeSavedCard(pool: Pool, adapter: PaymentAdapter, input: { attemptId: string; order_id: string; method: { id: string; provider_token: string }; amount: Money; callback_url: string }): Promise<void> {
  const { attemptId, order_id } = input
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
    if (transient(error)) await parkUnknown(pool, attemptId)
    else await closeWith(pool, client => refuseSavedCardAttempt(client, { attempt_id: attemptId, code }))
    return
  }
  switch (charged.outcome) {
    case 'paid':
      // A charge response only identifies the payment; settlement requires the provider lookup.
      await pool.query("UPDATE payment_attempts SET provider_ref=$2,status=CASE WHEN status IN ('created','unknown') THEN 'pending' ELSE status END,updated_at=now() WHERE id=$1", [attemptId, charged.payment.payment_id])
      return
    case 'declined':
      await closeWith(pool, client => failSavedCardAttempt(client, { attempt_id: attemptId, message: charged.message, code: charged.payment.decline_code }))
      return
    case 'needs_customer_action':
      await closeWith(pool, client => failSavedCardAttempt(client, { attempt_id: attemptId, hard: true,
        closed: { action: 'payment.saved_card_needs_customer_action', reason: 'The saved card needs the customer to act (authentication); it cannot be charged in the background' } }))
      return
    case 'token_unusable':
      await closeWith(pool, client => failSavedCardAttempt(client, { attempt_id: attemptId, hard: true,
        closed: { action: 'payment.saved_card_unusable', reason: 'The provider refused the saved card; it is marked inactive' }, metadata: { payment_method_id: input.method.id } }))
      return
    case 'unknown':
      await parkUnknown(pool, attemptId)
      return
    default: { const exhausted: never = charged; throw new Error(`unhandled charge outcome ${JSON.stringify(exhausted)}`) }
  }
}
