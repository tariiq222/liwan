// Card payments through the embedded form. A form payment is made by the browser with the publishable key, so nothing the browser
// says counts: a payment settles only when it was fetched from the provider with the secret key and every check in `checkFormPayment`
// holds. The payment id reaches the control plane as an untrusted hint (the callback, a webhook), never as proof.
// How the provider behaves is recorded in docs/operations/moyasar-form-spike.md.
import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { transaction } from '../db.js'
import { CommercialHttpError } from './lifecycle.js'
import type { FormPaymentSession } from '@liwan/commercial-contracts'
import { PaymentError, type PaymentAdapter, type PaymentIntent, type PaymentRecord, type ProviderEvent, type TokenInfo } from './payment-adapter.js'
import { claimOutbox, deferOutbox, enqueueOutbox, releaseOutbox } from './outbox.js'

type Queryable = Pick<Pool | PoolClient, 'query'>
type Row = Record<string, any>

/** The provider's intent lives one hour; a form attempt ends a little before it, so an attempt never outlives the intent it opened. */
export const FORM_ATTEMPT_LIFETIME_MS = 55 * 60_000
/** An intent with less time left than this is not handed to a browser: the payer could not finish typing a card. */
const MIN_INTENT_REMAINING_MS = 60_000
/** The statuses in which an attempt blocks a new one for the same order (the `payment_attempts_one_live` index). */
export const LIVE_ATTEMPT_STATUSES = ['created', 'redirected', 'pending', 'unknown'] as const
export const TOKEN_DELETE_KIND = 'payment_token.delete'

/** What a payment id from a browser may look like: an opaque provider id, never a place for anything else. */
const PAYMENT_HINT = /^[A-Za-z0-9_-]{8,100}$/
export const isPaymentHint = (value: unknown): value is string => typeof value === 'string' && PAYMENT_HINT.test(value)

export type FormRejection =
  | 'bad_shape' | 'payment_not_found' | 'description_unrecognized' | 'attempt_unknown' | 'attempt_mismatch' | 'not_form_attempt' | 'mode_mismatch'
  | 'amount_mismatch' | 'intent_missing' | 'callback_mismatch' | 'payment_bound_elsewhere' | 'settlement_mismatch'
export type FormSource = 'hint' | 'webhook'

const logCode = (error: unknown) => (error as { code?: string } | null)?.code ?? (error as Error | null)?.constructor?.name ?? 'error'

async function writeAudit(db: Queryable, action: string, subject: string, reason: string, metadata: Record<string, unknown>) {
  await db.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), 'system', action, subject, reason, JSON.stringify(metadata)])
}

/**
 * A payment that could not be tied to its attempt changes nothing. The audit event names the attempt and the payment so the operator can
 * find money that arrived and settled nothing; `form_hint_rejected` is the browser's hint, `form_payment_rejected` a payment the provider
 * itself reported. No untrusted text goes into the row: only the reason code and ids of a bounded shape.
 */
export async function rejectFormPayment(db: Queryable, source: FormSource, reason: FormRejection, ids: { attempt_id?: string; order_id?: string; payment_id?: string }) {
  const subject = ids.order_id ?? ids.attempt_id ?? ids.payment_id ?? 'unknown'
  await writeAudit(db, source === 'hint' ? 'payment.form_hint_rejected' : 'payment.form_payment_rejected', subject, `Card form payment not accepted: ${reason}`,
    { reason, attempt_id: ids.attempt_id ?? null, payment_id: ids.payment_id && PAYMENT_HINT.test(ids.payment_id) ? ids.payment_id : null })
  return { outcome: 'rejected' as const, reason }
}

/** The callback URL of an attempt names the attempt and nothing else in its query. */
function callbackNamesAttempt(callbackUrl: string, attemptId: string): boolean {
  try {
    const url = new URL(callbackUrl)
    return url.pathname === '/api/commercial/payment-callback' && [...url.searchParams.keys()].join() === 'attempt' && url.searchParams.get('attempt') === attemptId
  } catch { return false }
}

/**
 * Every check a fetched payment must pass before it may settle an attempt. It returns the first failing reason, or null.
 * - the attempt is a form attempt of this provider and mode, and the payment was read with this mode's key;
 * - the locked description names this attempt (the only field the browser cannot choose on an intent payment);
 * - amount, currency and exponent equal the attempt's own;
 * - the callback URL is the one the provider locked into this attempt's intent, read back with the secret key, and names this attempt;
 * - the payment is not already the reference of another attempt.
 * The paid status is the caller's, because only a paid payment is worth checking.
 */
export async function checkFormPayment(db: Queryable, adapter: PaymentAdapter, attempt: Row, record: PaymentRecord): Promise<FormRejection | null> {
  if (attempt.kind !== 'form') return 'not_form_attempt'
  if (attempt.provider !== adapter.provider || attempt.mode !== adapter.mode || record.live !== (adapter.mode === 'live')) return 'mode_mismatch'
  if (record.attempt_id !== attempt.id) return 'attempt_mismatch'
  const same = (m: { minor: number; currency: string; exponent: number }) => m.minor === Number(attempt.amount_minor) && m.currency === attempt.currency && m.exponent === attempt.exponent
  if (!same(record.amount)) return 'amount_mismatch'
  if (!attempt.provider_intent_ref) return 'intent_missing'
  let intent: PaymentIntent
  try { intent = await adapter.getIntent(attempt.provider_intent_ref) } catch (error) {
    if (error instanceof PaymentError && error.code === 'not_found') return 'intent_missing'
    throw error
  }
  if (!same(intent.amount)) return 'amount_mismatch'
  if (record.callback_url === null || record.callback_url !== intent.callback_url || !callbackNamesAttempt(intent.callback_url, attempt.id)) return 'callback_mismatch'
  const elsewhere = await db.query('SELECT 1 FROM payment_attempts WHERE provider=$1 AND provider_ref=$2 AND id<>$3', [attempt.provider, record.payment_id, attempt.id])
  return elsewhere.rowCount ? 'payment_bound_elsewhere' : null
}

/** What to do with the card token of a settled payment. It is decided before the settlement transaction, because reading a token is a provider call. */
export type CardPlan =
  | { kind: 'none' }
  /** The attempt asked to keep the card and the token is active with complete display facts. */
  | { kind: 'save'; token: string; brand: string; last_four: string; exp_month: number; exp_year: number; funding: string | null }
  /** The payment carries a token that must not be kept: it was not asked for, or it is unusable. The reason is for the audit. */
  | { kind: 'discard'; token: string; reason: 'not_requested' | 'token_not_active' | 'token_read_failed' | 'token_details_incomplete' }
  /** The attempt asked to keep the card but the payment has no token. */
  | { kind: 'missing_token' }

/** What the settlement carries in and out: the card decision, and whether the settlement acted on it. */
export type FormSettlement = { plan: CardPlan; authenticated: boolean | null; handled: boolean }

export async function planCard(adapter: PaymentAdapter, attempt: Row, record: PaymentRecord): Promise<CardPlan> {
  if (!record.token) return attempt.save_card ? { kind: 'missing_token' } : { kind: 'none' }
  if (!attempt.save_card) return { kind: 'discard', token: record.token, reason: 'not_requested' }
  let info: TokenInfo
  // A token that cannot be read is never kept, and never blocks the payment: the money is already the provider's fact.
  try { info = await adapter.getToken(record.token) } catch (error) {
    console.error('[payments] could not read the saved card of attempt %s (%s)', attempt.id, logCode(error))
    return { kind: 'discard', token: record.token, reason: 'token_read_failed' }
  }
  if (!info.active) return { kind: 'discard', token: record.token, reason: 'token_not_active' }
  if (!info.brand || !info.last_four || !info.exp_month || !info.exp_year) return { kind: 'discard', token: record.token, reason: 'token_details_incomplete' }
  return { kind: 'save', token: record.token, brand: info.brand, last_four: info.last_four, exp_month: info.exp_month, exp_year: info.exp_year, funding: info.funding }
}

/** A durable request to delete a card token at the provider. The token is kept only until the deletion succeeds. */
async function enqueueTokenDeletion(client: PoolClient, attempt: Row, token: string, aggregateId: string, dedupe: string) {
  await enqueueOutbox(client, { kind: TOKEN_DELETE_KIND, aggregate_id: aggregateId, dedupe_key: dedupe, payload: { provider: attempt.provider, mode: attempt.mode, token } })
}

/** The settlement audit event: what was settled and whether the payer's 3-D Secure result is known (the provider does not say, so it is usually null). */
async function recordFormSettlement(client: PoolClient, order: Row, attempt: Row, event: ProviderEvent, form: FormSettlement) {
  await writeAudit(client, 'payment.form_settled', order.id, 'Card form payment settled',
    { attempt_id: attempt.id, payment_id: event.payment_id, authenticated: form.authenticated, card: form.plan.kind })
}

/** The card of a payment that does not keep it (a duplicate, a payment returned to the customer, a payment that did not ask): deleted at the provider, durably. */
export async function discardCard(client: PoolClient, order: Row, attempt: Row, event: ProviderEvent, form: FormSettlement) {
  form.handled = true
  await recordFormSettlement(client, order, attempt, event, form)
  const { plan } = form
  if (plan.kind === 'save' || plan.kind === 'discard') {
    await enqueueTokenDeletion(client, attempt, plan.token, attempt.id, 'discarded')
    const orphan = plan.kind === 'discard' && plan.reason === 'not_requested'
    await writeAudit(client, orphan ? 'payment.token_orphan_deleted' : 'payment.card_not_saved', order.id,
      orphan ? 'The payment carried a card token that was not asked for; it is being deleted' : 'The card was not saved',
      { attempt_id: attempt.id, reason: plan.kind === 'discard' ? plan.reason : 'payment_not_kept' })
  } else if (plan.kind === 'missing_token') {
    await writeAudit(client, 'payment.card_not_saved', order.id, 'The card was not saved', { attempt_id: attempt.id, reason: 'token_missing' })
  }
}

/**
 * The settled payment keeps its card when the attempt asked for it: the card becomes the customer's default (the previous default is
 * removed and its token deleted at the provider), and auto-renew is switched on with the consent the attempt recorded. The subscription
 * row already exists when an order is placed, so this runs in the settlement transaction itself.
 */
export async function settleCard(client: PoolClient, order: Row, attempt: Row, event: ProviderEvent, form: FormSettlement) {
  const { plan } = form
  if (plan.kind !== 'save') return discardCard(client, order, attempt, event, form)
  form.handled = true
  await recordFormSettlement(client, order, attempt, event, form)
  const previous = (await client.query("SELECT id,provider_token FROM payment_methods WHERE customer_id=$1 AND is_default AND status='active' FOR UPDATE", [order.customer_id])).rows[0]
  if (previous?.provider_token === plan.token) return
  if (previous) {
    await client.query("UPDATE payment_methods SET status='removed',is_default=false,removed_at=now(),removed_by='system' WHERE id=$1", [previous.id])
    await enqueueTokenDeletion(client, attempt, previous.provider_token, previous.id, 'replaced')
  }
  const saved = await client.query(`INSERT INTO payment_methods(id,customer_id,provider,mode,provider_token,brand,last_four,exp_month,exp_year,funding,status,is_default,
      consent_at,consent_text_version,source_attempt_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',true,$11,$12,$13,'customer')
      ON CONFLICT ON CONSTRAINT payment_methods_token_unique DO NOTHING RETURNING id`,
  [randomUUID(), order.customer_id, attempt.provider, attempt.mode, plan.token, plan.brand, plan.last_four, plan.exp_month, plan.exp_year, plan.funding, attempt.consent_at, attempt.consent_text_version, attempt.id])
  if (!saved.rowCount) {
    await writeAudit(client, 'payment.card_not_saved', order.id, 'The card was not saved', { attempt_id: attempt.id, reason: 'token_already_saved' })
    return
  }
  await writeAudit(client, 'payment_method.saved', order.customer_id, 'Card saved from a card form payment',
    { payment_method_id: saved.rows[0].id, attempt_id: attempt.id, brand: plan.brand, last_four: plan.last_four })
  const enabled = await client.query(`UPDATE subscriptions SET auto_renew_enabled=true,auto_renew_consent_at=$2,revision=revision+1
    WHERE id=$1 AND NOT auto_renew_enabled RETURNING id`, [order.subscription_id, attempt.consent_at])
  if (enabled.rowCount) await writeAudit(client, 'auto_renew.enabled', order.subscription_id, 'Auto-renew enabled with the card saved at payment',
    { attempt_id: attempt.id, consent_text_version: attempt.consent_text_version })
}

/** The plan flag that lets a customer keep a card for renewal: read from the plan the order's target revision was sold under. */
export async function assertAutoRenewAllowed(client: Queryable, order: Row) {
  const plan = (await client.query(`SELECT p.auto_renew_allowed FROM subscription_revisions r
    JOIN plan_revisions p ON p.id::text = r.snapshot->>'plan_revision_id' WHERE r.id=$1`, [order.target_revision_id])).rows[0]
  if (!plan?.auto_renew_allowed) throw new CommercialHttpError('auto_renew_not_allowed', 409)
}

export type FormResolution =
  | { outcome: 'settled' | 'ignored' }
  | { outcome: 'not_paid'; status: PaymentRecord['status'] }
  | { outcome: 'rejected'; reason: FormRejection }

/** The settlement the caller owns (`apply` in payments.ts), given so that this module stays below it. */
export type SettleInTransaction = (client: PoolClient, event: ProviderEvent, form: FormSettlement) => Promise<'accepted' | 'ignored' | 'rejected'>

class SettlementMismatch extends Error {}

/**
 * Turns a payment id that nothing vouches for into a settled attempt, or into nothing. The payment is fetched with the secret key and
 * must name an existing form attempt (`expect`, when the caller knows which, is the only one it may name) and pass `checkFormPayment`.
 * Binding the payment to the attempt and settling it is one transaction under the order and attempt locks, so a callback and a webhook
 * racing for the same payment settle it once. A payment on an attempt that already has another payment becomes a sibling attempt row
 * that settles as a duplicate charge; a payment on a closed attempt settles as a late payment. Neither is lost.
 */
export async function resolveFormPayment(pool: Pool, adapter: PaymentAdapter, input: { payment_id: string; source: FormSource; expect?: Row; event_id?: string; settle: SettleInTransaction }): Promise<FormResolution> {
  const reject = (reason: FormRejection, ids: { attempt_id?: string; order_id?: string } = {}) =>
    rejectFormPayment(pool, input.source, reason, { ...ids, payment_id: input.payment_id })
  let record: PaymentRecord
  try { record = await adapter.readPayment(input.payment_id) } catch (error) {
    if (error instanceof PaymentError && error.code === 'not_found') return reject('payment_not_found', { attempt_id: input.expect?.id })
    throw error
  }
  if (!record.attempt_id) return reject('description_unrecognized', { attempt_id: input.expect?.id })
  if (input.expect && record.attempt_id !== input.expect.id) return reject('attempt_mismatch', { attempt_id: input.expect.id })
  if (record.status !== 'succeeded') return { outcome: 'not_paid', status: record.status }
  const attempt = (await pool.query('SELECT * FROM payment_attempts WHERE id=$1', [record.attempt_id])).rows[0]
  if (!attempt) return reject('attempt_unknown')
  const reason = await checkFormPayment(pool, adapter, attempt, record)
  if (reason) return reject(reason, { attempt_id: attempt.id, order_id: attempt.order_id })
  const form: FormSettlement = { plan: await planCard(adapter, attempt, record), authenticated: record.authenticated, handled: false }
  let result: FormResolution
  try {
    result = await transaction(pool, async client => {
      const order = (await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [attempt.order_id])).rows[0]
      const current = (await client.query('SELECT * FROM payment_attempts WHERE id=$1 FOR UPDATE', [attempt.id])).rows[0]
      if (current.provider_ref === record.payment_id) return { outcome: 'ignored' as const }
      let target = current
      if (current.provider_ref) {
        target = (await client.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,provider_ref,merchant_ref,amount_minor,currency,exponent,status,kind)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'canceled','form') RETURNING *`,
        [randomUUID(), current.order_id, current.invoice_id, current.provider, current.mode, record.payment_id, current.merchant_ref, current.amount_minor, current.currency, current.exponent])).rows[0]
      } else {
        await client.query('UPDATE payment_attempts SET provider_ref=$2,updated_at=now() WHERE id=$1', [current.id, record.payment_id])
        target = { ...current, provider_ref: record.payment_id }
      }
      const event = formPaymentEvent(adapter, record, target.id, input.event_id)
      const outcome = await input.settle(client, event, form)
      if (outcome === 'rejected') throw new SettlementMismatch()
      if (!form.handled && (form.plan.kind === 'save' || form.plan.kind === 'discard')) await discardCard(client, order, target, event, form)
      return { outcome: outcome === 'accepted' ? 'settled' as const : 'ignored' as const }
    })
  } catch (error) {
    if (error instanceof SettlementMismatch) return reject('settlement_mismatch', { attempt_id: attempt.id, order_id: attempt.order_id })
    throw error
  }
  // After the commit, never inside it: the provider call that deletes a replaced or unwanted token holds no lock. A failure stays queued.
  if (result.outcome === 'settled') await processTokenDeletions(pool, adapter)
  return result
}

/** The event the settlement machine takes, built from the payment the provider reported: its id is the provider reference of a form attempt. */
export function formPaymentEvent(adapter: PaymentAdapter, record: PaymentRecord, attemptId: string, eventId?: string): ProviderEvent {
  return {
    provider: adapter.provider, event_id: eventId ?? `lookup:${record.payment_id}:${record.provider_status}`, provider_ref: record.payment_id, payment_id: record.payment_id,
    attempt_id: attemptId, merchant_account: adapter.merchantAccount, live: record.live, status: record.status, amount: record.amount,
    ...(record.refunded ? { refunded: record.refunded } : {}), occurred_at: new Date().toISOString(), raw_type: `payment_${record.provider_status}`,
  }
}

/** What the browser is given to open the card form. The client secret is read from the provider each time; it is never stored. */
export function formSession(adapter: PaymentAdapter, row: Row, intent: PaymentIntent): FormPaymentSession {
  const lifetimeEnd = new Date(row.created_at).getTime() + FORM_ATTEMPT_LIFETIME_MS
  return {
    attempt_id: row.id as string, intent: { id: intent.id, client_secret: intent.client_secret }, publishable_key: adapter.publishableKey as string,
    amount: { minor: Number(row.amount_minor), currency: row.currency as string, exponent: row.exponent as number },
    expires_at: new Date(Math.min(lifetimeEnd, new Date(intent.expires_at).getTime())).toISOString(),
  }
}

/** An intent a browser may still fulfil, with time to do it. */
export function intentUsable(intent: PaymentIntent): boolean {
  return intent.status === 'created' && new Date(intent.expires_at).getTime() - Date.now() > MIN_INTENT_REMAINING_MS
}

export async function readIntent(adapter: PaymentAdapter, ref: string | null): Promise<PaymentIntent | null> {
  if (!ref) return null
  try { return await adapter.getIntent(ref) } catch (error) {
    if (error instanceof PaymentError && error.code === 'not_found') return null
    throw error
  }
}

/** Cancels an intent that may still be open; a refusal because it is already consumed is an answer, and an outage is logged, never hidden. */
export async function cancelIntentQuietly(adapter: PaymentAdapter, ref: string | null): Promise<'canceled' | 'not_cancelable' | 'failed'> {
  if (!ref) return 'canceled'
  try { return await adapter.cancelIntent(ref) } catch (error) {
    console.error('[payments] could not cancel intent of a form attempt (%s)', logCode(error))
    return 'failed'
  }
}

/**
 * Closes a form attempt nobody paid, locally and at the provider. The order stays payable. A payment that shows up afterwards is
 * still found by its description and settled as a late payment, so closing never loses money.
 */
export async function closeUnpaidFormAttempt(pool: Pool, adapter: PaymentAdapter, row: Row, reason: 'expired' | 'method_changed' | 'order_paid') {
  await cancelIntentQuietly(adapter, row.provider_intent_ref)
  await transaction(pool, async client => {
    const closed = await client.query("UPDATE payment_attempts SET status='canceled',updated_at=now() WHERE id=$1 AND provider_ref IS NULL AND status = ANY($2::text[]) RETURNING order_id", [row.id, LIVE_ATTEMPT_STATUSES])
    if (closed.rowCount) await writeAudit(client, 'payment.form_attempt_closed', row.order_id, `Unpaid card form attempt closed: ${reason}`, { attempt_id: row.id, reason })
  })
}

/**
 * The customer asks for another way to pay while a form attempt is open. It is closed only when no payment can exist for it: the intent
 * was never fulfilled (it is cancelled here, and a refusal means it was fulfilled in the meantime) or never created. A consumed intent may
 * hold a payment, paid or still being authenticated, that nothing can look up, so it is not closed until the attempt's own lifetime ends.
 */
export async function retireLiveFormAttempt(pool: Pool, adapter: PaymentAdapter, row: Row) {
  if (row.provider_ref) throw new CommercialHttpError('payment_in_progress', 409)
  if (row.provider_intent_ref) {
    const intent = await readIntent(adapter, row.provider_intent_ref)
    if (intent && intent.status !== 'canceled' && intent.status !== 'created') throw new CommercialHttpError('payment_in_progress', 409)
    // An intent past its expiry was never fulfilled (a fulfilled one reads `fulfilled`), so cancelling it cannot meet a payment.
    if (intent?.status === 'created' && new Date(intent.expires_at).getTime() > Date.now() && await adapter.cancelIntent(intent.id) === 'not_cancelable')
      throw new CommercialHttpError('payment_in_progress', 409)
  }
  await closeUnpaidFormAttempt(pool, adapter, row, 'method_changed')
}

/**
 * Deletes card tokens at the provider: the default card a new card replaced, and a token that came with a payment that did not keep it.
 * A failure is logged by code, leaves the row pending and is retried with backoff; the token leaves the row once the deletion is done.
 */
export async function processTokenDeletions(pool: Pool, adapter: PaymentAdapter | undefined, limit = 20): Promise<number> {
  let deleted = 0
  for (const row of await claimOutbox(pool, [TOKEN_DELETE_KIND], limit)) {
    const payload = row.payload as { provider: string; mode: string; token: string }
    if (!adapter || adapter.provider !== payload.provider || adapter.mode !== payload.mode) { await releaseOutbox(pool, row.id); continue }
    try {
      await adapter.deleteToken(payload.token)
      await pool.query("UPDATE commercial_outbox SET status='done',processed_at=now(),payload=payload-'token' WHERE id=$1 AND status='pending'", [row.id])
      deleted++
    } catch (error) {
      const code = logCode(error)
      console.error(JSON.stringify({ event: 'payment_token_delete_failed', outbox_id: row.id, code }))
      await deferOutbox(pool, row.id, code)
    }
  }
  return deleted
}
