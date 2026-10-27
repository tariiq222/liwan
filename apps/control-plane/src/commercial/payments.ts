import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { z } from 'zod'
import { nextOrderState, type OrderStateInput } from '@webvue/commercial-contracts'
import { transaction } from '../db.js'
import { CommercialHttpError, iso } from './lifecycle.js'
import { assertReturnUrl, toBytes, type AdapterHeaders, type PaymentAdapter, type ProviderEvent } from './payment-adapter.js'
import { confirmEvent } from './moyasar-adapter.js'
import { enqueueOutbox } from './outbox.js'
import type { ReturnOrigin } from './return-origin.js'
import { onRenewalPaid } from './renewals.js'

export function paymentAttemptView(row: any) {
  return { id: row.id, order_id: row.order_id, invoice_id: row.invoice_id, provider: row.provider, mode: row.mode,
    provider_ref: row.provider_ref, status: row.status, redirect_url: row.redirect_url,
    amount: { minor: Number(row.amount_minor), currency: row.currency, exponent: row.exponent },
    created_at: iso(row.created_at), updated_at: iso(row.updated_at) }
}
/** A return origin is one concrete origin (never a wildcard allowlist entry); `return-origin.ts` picks it per customer. */
export function assertReturnOrigin(allowedOrigin: string) {
  let origin: string
  if (allowedOrigin.includes('*')) throw new CommercialHttpError('return_url_forbidden', 422)
  try { origin = new URL(allowedOrigin).origin } catch { throw new CommercialHttpError('return_url_forbidden', 422) }
  if (allowedOrigin !== origin) throw new CommercialHttpError('return_url_forbidden', 422)
  // The same rules the provider adapter applies to the final URL (scheme, credentials, origin), so an
  // unusable origin fails before any order, invoice or renewal is written.
  try { assertReturnUrl(`${origin}/`, [origin]) } catch { throw new CommercialHttpError('return_url_forbidden', 422) }
  return origin
}
/** One URL serves success_url, back_url and callback_url; the attempt id is the only thing the browser or provider carries back. */
export function paymentReturnUrls(allowedOrigin: string, attemptId: string) {
  const origin = assertReturnOrigin(allowedOrigin)
  if (!z.uuid().safeParse(attemptId).success) throw new CommercialHttpError('return_url_forbidden', 422)
  return assertReturnUrl(`${origin}/api/commercial/payment-callback?attempt=${attemptId}`, [origin])
}
const matches = (a: any, e: ProviderEvent) => a.provider === e.provider && a.provider_ref === e.provider_ref
  && (!e.attempt_id || e.attempt_id === a.id) && Number(a.amount_minor) === e.amount.minor
  && a.currency === e.amount.currency && a.exponent === e.amount.exponent && (a.mode === 'live') === e.live

async function apply(client: PoolClient, event: ProviderEvent): Promise<'accepted' | 'ignored' | 'rejected'> {
  const found = (await client.query('SELECT order_id FROM payment_attempts WHERE provider=$1 AND provider_ref=$2', [event.provider, event.provider_ref])).rows[0]
  if (!found) return 'rejected'
  // Order-first lock order matches attempt creation and serializes separate attempts.
  const order = (await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [found.order_id])).rows[0]
  const attempt = (await client.query('SELECT * FROM payment_attempts WHERE provider=$1 AND provider_ref=$2 FOR UPDATE', [event.provider, event.provider_ref])).rows[0]
  if (!matches(attempt, event)) return 'rejected'
  // A provider cancel or expiry is not a payment failure: nobody was charged and the invoice cannot be paid
  // any more, so the order stays `awaiting_payment` and the customer can start a new attempt. Only a decline
  // (`failed`) moves the order to `failed`.
  if (event.status === 'canceled') {
    const closed = await client.query("UPDATE payment_attempts SET status='canceled',updated_at=now() WHERE id=$1 AND status IN ('created','redirected','pending','unknown')", [attempt.id])
    return closed.rowCount ? 'accepted' : 'ignored'
  }
  // Only the attempt that paid the order may move it. A refund (or any other event) of a recorded duplicate
  // charge belongs to that attempt alone: audit it and leave the order, its fulfillment and its invoice untouched.
  // The duplicate's pending credit note is left for the operator action, which records the refund reference.
  if (order.paid_attempt_id && order.paid_attempt_id !== attempt.id && event.status === 'refunded') {
    const logged = await client.query("SELECT 1 FROM audit_events WHERE action='payment.duplicate_refunded' AND subject=$1 AND metadata->>'attempt_id'=$2", [order.id, attempt.id])
    if (!logged.rowCount) await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(),'system','payment.duplicate_refunded',order.id,'Duplicate payment refunded at the provider',JSON.stringify({ attempt_id: attempt.id, event_id: event.event_id, payment_id: event.payment_id })])
    return 'accepted'
  }
  const type = event.status === 'succeeded' ? 'payment_succeeded' : event.status === 'refunded' ? 'payment_refunded'
    : event.status === 'failed' ? 'payment_failed' : 'payment_pending'
  const next = nextOrderState(order as OrderStateInput, { type })
  if (next.ignored) {
    // A confirmed charge for an attempt that did not pay an order that is already paid (or refund-bound) is a
    // second charge: record it, and queue a credit note for the operator instead of silently ignoring money.
    if (event.status === 'succeeded' && attempt.status !== 'succeeded' && ['paid', 'refund_pending', 'refunded'].includes(order.payment_state)) {
      await client.query("UPDATE payment_attempts SET status='succeeded',updated_at=now() WHERE id=$1", [attempt.id])
      const reason = 'Duplicate payment on an already paid order — manual refund'
      const inserted = await enqueueOutbox(client, { kind: 'reconcile.refund', aggregate_id: order.id, dedupe_key: event.event_id,
        payload: { order_id: order.id, attempt_id: attempt.id, payment_id: event.payment_id, event_id: event.event_id, duplicate: true } })
      if (inserted) await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
        [randomUUID(),'system','payment.duplicate_charge',order.id,reason,JSON.stringify({ attempt_id: attempt.id, event_id: event.event_id, payment_id: event.payment_id })])
      return 'accepted'
    }
    return 'ignored'
  }
  await client.query('UPDATE orders SET payment_state=$2,fulfillment_state=$3 WHERE id=$1', [order.id, next.payment_state, next.fulfillment_state])
  if (event.status === 'succeeded') {
    await client.query("UPDATE payment_attempts SET status='succeeded',updated_at=now() WHERE id=$1", [attempt.id])
    await client.query('UPDATE orders SET paid_attempt_id=$2 WHERE id=$1 AND paid_attempt_id IS NULL', [order.id, attempt.id])
    await client.query("UPDATE invoices SET status='paid',paid_at=COALESCE(paid_at,now()) WHERE id=$1 AND status='issued'", [attempt.invoice_id])
    if (next.reconcile) {
      await enqueueOutbox(client, { kind: 'reconcile.refund', aggregate_id: order.id, dedupe_key: event.event_id,
        payload: { order_id: order.id, attempt_id: attempt.id, payment_id: event.payment_id, event_id: event.event_id } })
    } else {
      await enqueueOutbox(client, { kind: 'fulfillment.enqueue', aggregate_id: order.id, dedupe_key: order.target_revision_id,
        payload: { order_id: order.id, subscription_id: order.subscription_id, target_revision_id: order.target_revision_id } })
      if (order.kind === 'renewal') await onRenewalPaid(client, order.id)
    }
  } else if (event.status === 'refunded') {
    if (order.fulfillment_state === 'applied') {
      const reason = 'Payment refunded after fulfillment — manual review'
      const inserted = await enqueueOutbox(client, { kind: 'payment.intervention', aggregate_id: order.id,
        dedupe_key: attempt.id, payload: { order_id: order.id, attempt_id: attempt.id, reason } })
      if (inserted) await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
        [randomUUID(),'system','payment.intervention',order.id,reason,JSON.stringify({ attempt_id: attempt.id, event_id: event.event_id })])
    }
  } else if (event.status === 'failed') {
    await client.query("UPDATE payment_attempts SET status='failed',updated_at=now() WHERE id=$1", [attempt.id])
  }
  return 'accepted'
}

/** Only authoritative adapter-fetched events may enter this settlement boundary. */
export async function applyConfirmedEvent(pool: Pool, event: ProviderEvent) {
  return transaction(pool, client => apply(client, event))
}

export async function handleProviderEvent(pool: Pool, input: { provider: string; rawBody: Uint8Array | string; headers: AdapterHeaders; adapter: PaymentAdapter }) {
  let event: ProviderEvent
  try {
    event = input.adapter.verifyEvent(toBytes(input.rawBody), input.headers)
    if (input.provider !== input.adapter.provider || event.provider !== input.provider || !event.event_id
      || !['pending','succeeded','failed','refunded','canceled'].includes(event.status)
      || !Number.isSafeInteger(event.amount.minor) || event.amount.minor < 0) throw new Error('invalid_event')
  } catch { return { status: 401, outcome: 'rejected' as const } }
  const result = await transaction(pool, async client => {
    const id = randomUUID()
    const inserted = await client.query(`INSERT INTO payment_events(id,provider,provider_event_id,status,amount_minor,currency,exponent,verified,confirmed,outcome)
      VALUES($1,$2,$3,$4,$5,$6,$7,true,false,'accepted') ON CONFLICT DO NOTHING RETURNING id`,
    [id,event.provider,event.event_id,event.status,event.amount.minor,event.amount.currency,event.amount.exponent])
    if (!inserted.rowCount) return { status: 200, outcome: 'duplicate' as const }
    let confirmed: ProviderEvent
    const tokenCharge = (await client.query('SELECT token_charge FROM payment_attempts WHERE provider=$1 AND provider_ref=$2', [event.provider, event.provider_ref])).rows[0]?.token_charge === true
    try { confirmed = await confirmEvent(input.adapter, event, { tokenCharge }) } catch (e) {
      if ((e as { code?: string }).code !== 'event_mismatch') throw e // transient fetch failure rolls back for redelivery
      await client.query("UPDATE payment_events SET outcome='rejected',reason='event_mismatch' WHERE id=$1", [id])
      return { status: 200, outcome: 'rejected' as const }
    }
    const outcome = await apply(client, { ...confirmed, event_id: event.event_id })
    await client.query(`UPDATE payment_events SET confirmed=true,outcome=$2,reason=$3,
      attempt_id=(SELECT id FROM payment_attempts WHERE provider=$4 AND provider_ref=$5) WHERE id=$1`,
    [id,outcome === 'rejected' ? 'rejected' : 'accepted',outcome === 'rejected' ? 'attempt_mismatch' : null,event.provider,event.provider_ref])
    return { status: 200, outcome, paid: outcome === 'accepted' && confirmed.status === 'succeeded' ? confirmed : null }
  })
  if ('paid' in result && result.paid) await closeSiblingAttempts(pool, input.adapter, result.paid)
  return { status: result.status, outcome: result.outcome }
}

/**
 * Once an attempt paid its order, any other attempt of that order must not stay payable. The provider call runs
 * after the settlement commit; one that fails is left for the reconciler, and a later success on it is recorded
 * as a duplicate charge (never ignored).
 */
async function closeSiblingAttempts(pool: Pool, adapter: PaymentAdapter, paid: ProviderEvent) {
  const siblings = (await pool.query(`SELECT s.* FROM payment_attempts a JOIN payment_attempts s ON s.order_id=a.order_id AND s.id<>a.id
    WHERE a.provider=$1 AND a.provider_ref=$2 AND a.status='succeeded' AND s.status IN ('created','redirected','pending','unknown')`,
  [paid.provider, paid.provider_ref])).rows
  for (const sibling of siblings) {
    if (!sibling.provider_ref || sibling.provider !== adapter.provider || sibling.mode !== adapter.mode || !adapter.cancelAttempt) continue
    try {
      await adapter.cancelAttempt(sibling.provider_ref)
      await pool.query("UPDATE payment_attempts SET status='canceled',updated_at=now() WHERE id=$1 AND status IN ('created','redirected','pending','unknown')", [sibling.id])
    } catch (error) {
      // The invoice stays payable until it expires; a payment on it later is recorded by the duplicate-charge path,
      // and the reconciler cancels it once it looks the attempt up again.
      console.error(`[payments] could not cancel sibling attempt ${sibling.id} (${(error as { code?: string })?.code ?? (error as Error)?.constructor?.name ?? 'error'})`)
    }
  }
}

export async function lookup(pool: Pool, adapter: PaymentAdapter, row: any) {
  if (row.provider !== adapter.provider || row.mode !== adapter.mode) throw new CommercialHttpError('provider_mismatch', 409)
  // A token charge has a payment id, not an invoice: the invoice endpoint would answer 404 for it.
  let event: ProviderEvent | null | undefined
  try {
    event = row.token_charge ? (row.provider_ref ? await adapter.lookupPayment?.(row.provider_ref) : null)
      : row.provider_ref ? await adapter.lookupAttempt(row.provider_ref) : await adapter.lookupByAttemptId?.(row.id)
  } catch (error) {
    if (row.token_charge && (error as { code?: string }).code === 'not_found' && await closeMissingTokenCharge(pool, row)) return 'ignored' as const
    throw error
  }
  if (!event) throw new CommercialHttpError('payment_unknown', 503)
  if (event.provider !== adapter.provider || event.merchant_account !== adapter.merchantAccount || event.live !== (adapter.mode === 'live')
    || (event.attempt_id && event.attempt_id !== row.id) || (row.provider_ref && event.provider_ref !== row.provider_ref)
    || Number(row.amount_minor) !== event.amount.minor || row.currency !== event.amount.currency || row.exponent !== event.amount.exponent)
    throw new CommercialHttpError('payment_mismatch', 409)
  // Timeout may have lost only the create response, not the provider-side attempt.
  await pool.query('UPDATE payment_attempts SET provider_ref=COALESCE(provider_ref,$2),updated_at=now() WHERE id=$1', [row.id,event.provider_ref])
  const outcome = await applyConfirmedEvent(pool, event)
  if (outcome === 'accepted' && event.status === 'succeeded') await closeSiblingAttempts(pool, adapter, event)
  // A pending answer changes nothing in the order, so it would leave an attempt parked as `unknown`
  // (a cancel that crashed before reaching the provider) unable to be paid or cancelled again.
  if (event.status === 'pending' && row.status === 'unknown')
    await pool.query("UPDATE payment_attempts SET status='pending',updated_at=now() WHERE id=$1 AND status='unknown'", [row.id])
  // A hosted invoice that is still payable while another attempt already paid the order must not stay payable.
  if (event.status === 'pending' && !row.token_charge && row.provider_ref && adapter.cancelAttempt
    && (await pool.query('SELECT 1 FROM orders WHERE id=$1 AND paid_attempt_id IS NOT NULL AND paid_attempt_id<>$2', [row.order_id, row.id])).rowCount) {
    try {
      await adapter.cancelAttempt(row.provider_ref)
      await pool.query("UPDATE payment_attempts SET status='canceled',updated_at=now() WHERE id=$1 AND status IN ('created','redirected','pending','unknown')", [row.id])
    } catch (error) { console.error(`[payments] could not cancel attempt ${row.id} of a paid order (${(error as { code?: string })?.code ?? 'error'})`) }
  }
  return outcome
}

/** A token charge the provider says does not exist never charged anyone, so it no longer blocks a new attempt. */
const MISSING_CHARGE_GRACE_MS = 60 * 60_000
async function closeMissingTokenCharge(pool: Pool, row: any): Promise<boolean> {
  // Before the charge response arrived the reference is only our own order id, which proves nothing by itself:
  // wait out a grace period (the response may simply have been lost) before declaring it missing.
  const unproven = !row.provider_ref || row.provider_ref === row.order_id
  if (unproven && Date.now() - new Date(row.created_at).getTime() < MISSING_CHARGE_GRACE_MS) return false
  return transaction(pool, async client => {
    const closed = await client.query("UPDATE payment_attempts SET status='failed',updated_at=now() WHERE id=$1 AND status IN ('created','redirected','pending','unknown') RETURNING id", [row.id])
    if (!closed.rowCount) return false
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(),'system','payment.token_charge_missing',row.order_id,'The provider has no such token charge; the attempt was closed',JSON.stringify({ attempt_id: row.id, provider_ref: row.provider_ref })])
    return true
  })
}

/** A hosted invoice is created with this lifetime; past it, a live attempt may already be unpayable at the provider. */
const ATTEMPT_LIFETIME_MS = 30 * 60_000

export async function createPaymentAttempt(pool: Pool, input: { order_id: string; customer_id: string; adapter: PaymentAdapter; returnOrigin: ReturnOrigin }) {
  // The id is fixed before the reservation so an unusable origin fails before any write.
  const attemptId = randomUUID()
  const url = paymentReturnUrls(await input.returnOrigin(input.customer_id), attemptId)
  const reserve = () => transaction(pool, async client => {
    const order = (await client.query('SELECT * FROM orders WHERE id=$1 AND customer_id=$2 FOR UPDATE', [input.order_id,input.customer_id])).rows[0]
    if (!order) throw new CommercialHttpError('not_found', 404)
    if (order.payment_state !== 'awaiting_payment' || order.cancelled) throw new CommercialHttpError('payment_not_awaiting', 409)
    const live = (await client.query("SELECT * FROM payment_attempts WHERE order_id=$1 AND status IN ('created','redirected','pending','unknown')", [order.id])).rows[0]
    if (live) return { row: live, fresh: false }
    const invoice = (await client.query("SELECT * FROM invoices WHERE order_id=$1 AND status='issued' ORDER BY created_at LIMIT 1 FOR UPDATE", [order.id])).rows[0]
    if (!invoice || Number(invoice.total_minor) <= 0) throw new CommercialHttpError('issued_invoice_required', 409)
    const row = (await client.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,merchant_ref,amount_minor,currency,exponent)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [attemptId,order.id,invoice.id,input.adapter.provider,input.adapter.mode,order.id,invoice.total_minor,invoice.currency,invoice.exponent])).rows[0]
    return { row, fresh: true }
  })
  let reservation = await reserve()
  // An invoice older than its lifetime may have expired unseen: ask the provider first, so an expired one is
  // closed (the order stays payable) and this call starts a fresh attempt instead of handing back a dead link.
  // At most one provider lookup per 5 seconds per attempt (the claim), and a failed lookup never blocks the
  // customer: the existing attempt is returned and the reconciler retries.
  if (!reservation.fresh && reservation.row.status !== 'unknown' && Date.now() - new Date(reservation.row.created_at).getTime() >= ATTEMPT_LIFETIME_MS) {
    const claimed = (await pool.query("UPDATE payment_attempts SET updated_at=now() WHERE id=$1 AND status IN ('created','redirected','pending') AND updated_at < now() - interval '5 seconds' RETURNING *", [reservation.row.id])).rows[0]
    if (claimed) {
      let looked = true
      try { await lookup(pool, input.adapter, claimed) } catch { looked = false /* the existing attempt is returned below */ }
      if (looked) reservation = await reserve()
    }
  }
  if (!reservation.fresh && reservation.row.status === 'unknown') {
    await lookup(pool, input.adapter, reservation.row)
    reservation = await reserve() // a closed attempt (missing token charge) no longer blocks a new one
  }
  if (!reservation.fresh) {
    return paymentAttemptView((await pool.query('SELECT * FROM payment_attempts WHERE id=$1', [reservation.row.id])).rows[0])
  }
  const row = reservation.row
  try {
    const created = await input.adapter.createAttempt({ attempt_id: row.id,order_id: row.order_id,
      amount: { minor: Number(row.amount_minor),currency: row.currency,exponent: row.exponent }, description: `WebVue order ${row.order_id}`,
      success_url: url, back_url: url, callback_url: url, expires_at: new Date(Date.now()+ATTEMPT_LIFETIME_MS).toISOString() })
    const updated = await pool.query(`UPDATE payment_attempts SET provider_ref=$2,redirect_url=$3,
      status=CASE WHEN status='created' THEN 'redirected' ELSE status END,updated_at=now() WHERE id=$1 RETURNING *`, [row.id,created.provider_ref,created.redirect_url])
    return paymentAttemptView(updated.rows[0])
  } catch {
    await pool.query("UPDATE payment_attempts SET status='unknown',updated_at=now() WHERE id=$1 AND status='created'", [row.id])
    throw new CommercialHttpError('payment_unknown', 503)
  }
}

/**
 * A browser or provider return is a lookup hint, never evidence of payment: the provider lookup is the only
 * evidence, and settlement goes through the existing state machine. The claim throttles repeated returns
 * (and a flood from one attempt) to one provider lookup per 5 seconds; the reconciler retries a failed lookup.
 */
export async function verifyReturnedAttempt(pool: Pool, input: { attempt_id: string; customer_id: string; adapter: PaymentAdapter }) {
  const owned = await pool.query('SELECT 1 FROM payment_attempts a JOIN orders o ON o.id=a.order_id WHERE a.id=$1 AND o.customer_id=$2', [input.attempt_id, input.customer_id])
  if (!owned.rowCount) throw new CommercialHttpError('not_found', 404)
  const claimed = (await pool.query(`UPDATE payment_attempts SET updated_at=now() WHERE id=$1 AND status IN ('redirected','pending','unknown')
    AND updated_at < now() - interval '5 seconds' RETURNING *`, [input.attempt_id])).rows[0]
  if (claimed) { try { await lookup(pool, input.adapter, claimed) } catch { /* the reconciler retries an unresolved lookup */ } }
  const order = (await pool.query('SELECT o.id,o.payment_state,o.fulfillment_state FROM orders o JOIN payment_attempts a ON a.order_id=o.id WHERE a.id=$1', [input.attempt_id])).rows[0]
  return { order_id: order.id as string, payment_state: order.payment_state as string, fulfillment_state: order.fulfillment_state as string }
}
export type ReconciliationOutcome = 'accepted' | 'ignored' | 'rejected' | 'unknown' | 'mismatch' | 'provider_unavailable' | 'provider_error' | 'lookup_failed'

/** Lookup only: unresolved provider state never authorizes a replacement charge. */
export async function reconcileUnknownAttempts(pool: Pool, adapter: PaymentAdapter,
  options: { clock?: () => number; limit?: number } = {}) {
  const now = new Date((options.clock ?? Date.now)())
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(100, Math.floor(options.limit!))) : 20
  // Rotate even failed lookups before leaving the database, so one unreachable
  // invoice cannot monopolize every bounded batch. Recent reservations may still
  // be in flight at the provider; only inspect created rows after a crash grace.
  const rows = (await pool.query(`WITH candidates AS (
    SELECT id FROM payment_attempts
    WHERE status IN ('created','unknown','redirected','pending') AND provider=$1 AND mode=$2
      AND (status<>'created' OR created_at<=$3::timestamptz - interval '5 minutes')
    ORDER BY updated_at,created_at,id LIMIT $4 FOR UPDATE SKIP LOCKED
  ) UPDATE payment_attempts AS attempt SET updated_at=$3
    FROM candidates WHERE attempt.id=candidates.id RETURNING attempt.*`,
  [adapter.provider, adapter.mode, now, limit])).rows
  const results: { id: string; outcome: ReconciliationOutcome }[] = []
  for (const row of rows) {
    try { results.push({ id: row.id, outcome: await lookup(pool, adapter, row) }) }
    catch (error) {
      const code = (error as { code?: string } | null)?.code
      const outcome: ReconciliationOutcome = code === 'payment_unknown' || code === 'not_found' ? 'unknown'
        : code === 'payment_mismatch' || code === 'provider_mismatch' || code === 'event_mismatch' ? 'mismatch'
          : code === 'timeout' || code === 'provider_unreachable' ? 'provider_unavailable'
            : code === 'provider_error' || code === 'provider_not_configured' || code === 'key_mode_mismatch' ? 'provider_error'
              : 'lookup_failed'
      results.push({ id: row.id, outcome })
    }
  }
  return results
}
