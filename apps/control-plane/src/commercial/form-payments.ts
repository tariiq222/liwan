// Card payments through the embedded form. A form payment is made by the browser with the publishable key, so nothing the browser
// says counts: a payment settles only when it was fetched from the provider with the secret key and every check in `checkFormPayment`
// holds. The payment id reaches the control plane as an untrusted hint (the callback, a webhook), never as proof.
// How the provider behaves is recorded in docs/operations/moyasar-form-spike.md.
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type { FormPaymentSession } from '@liwan/commercial-contracts'
import { transaction } from '../db.js'
import { CommercialHttpError } from './lifecycle.js'
import { PaymentError, type PaymentAdapter, type PaymentIntent, type PaymentRecord, type ProviderEvent, type TokenInfo } from './payment-adapter.js'
import { claimOutbox, deferOutbox, enqueueOutbox, releaseOutbox } from './outbox.js'
import { FORM_PAYMENT_HOLD_HOURS } from './notice-timings.js'
import { holdsFreeBaseLockSql } from './free-base.js'
import { deletionClockRunningSql } from './tenant-deletion-read.js'

type Queryable = Pick<Pool | PoolClient, 'query'>
type Row = Record<string, any>

/** The provider's intent lives one hour; a form attempt ends a little before it, so an attempt never outlives the intent it opened. */
export const FORM_ATTEMPT_LIFETIME_MS = 55 * 60_000
/** An intent with less time left than this is not handed to a browser: the payer could not finish typing a card. */
const MIN_INTENT_REMAINING_MS = 60_000
/** The statuses in which an attempt blocks a new one for the same order (the `payment_attempts_one_live` index). */
export const LIVE_ATTEMPT_STATUSES = ['created', 'redirected', 'pending', 'unknown'] as const
export const TOKEN_DELETE_KIND = 'payment_token.delete'
/** A token the provider keeps refusing to delete is given up on after this many tries or this long, and left to the operator. */
const TOKEN_DELETE_MAX_ATTEMPTS = 12
const TOKEN_DELETE_MAX_AGE_HOURS = 24
/** A payment id rejected for a permanent reason is answered from the audit log, without asking the provider again, for this long. */
const REJECTION_MEMORY_MINUTES = 5
/**
 * A budget never gates a provider read or a settlement; it only keeps one subject from filling the audit log. Money-relevant rejections
 * are counted per order (or attempt, or payment when neither is known) per hour; the trivial `bad_shape` ones have a budget of their own, so
 * they can never use up the one that records money.
 */
const REJECTION_SUBJECT_HOURLY_BUDGET = 20
const TRIVIAL_REJECTION_HOURLY_BUDGET = 200
/** One row per subject per hour says a rejection was not written, so the operator knows the log is incomplete for it (and raises a vendor alert). */
export const REJECTION_SUPPRESSED_ACTION = 'payment.form_rejection_suppressed'
/** A card that was refunded in full without any attempt having claimed it: the fact that clears its attention item. */
export const FORM_PAYMENT_REFUNDED_ACTION = 'payment.form_payment_refunded'
const CALLBACK_SECRET_PARAM = 'k'

/** What a payment id from a browser may look like: an opaque provider id, never a place for anything else. */
const PAYMENT_HINT = /^[A-Za-z0-9_-]{8,100}$/
export const isPaymentHint = (value: unknown): value is string => typeof value === 'string' && PAYMENT_HINT.test(value)

export type FormRejection =
  | 'bad_shape' | 'payment_not_found' | 'description_unrecognized' | 'attempt_unknown' | 'attempt_mismatch' | 'not_form_attempt' | 'mode_mismatch'
  | 'amount_mismatch' | 'intent_missing' | 'intent_not_fulfilled' | 'callback_mismatch' | 'payment_bound_elsewhere' | 'attempt_has_other_payment'
  | 'settlement_mismatch' | 'refunded_unclaimed' | 'rate_limited' | 'intent_closed'
export type FormSource = 'hint' | 'webhook'
const REJECTION_ACTION: Record<FormSource, string> = { hint: 'payment.form_hint_rejected', webhook: 'payment.form_payment_rejected' }

/** Thrown inside the settlement transaction to roll it back; the caller turns it into the refusal it names. */
class SettlementRefused extends Error {
  constructor(readonly reason: FormRejection) { super(reason) }
}

/**
 * The one lock order of every writer that touches an order, its subscription or a saved card: customer, subscription, order, attempt,
 * payment method (`lockOrder` in orders.ts and fulfilment take them so; a card removal takes the subscription before the card).
 * A settlement takes the first two up front, before the order, because it can reach the subscription later (a saved card turns
 * auto-renew on, a paid renewal moves the subscription) and the card row after it.
 */
export async function lockSettlement(client: PoolClient, orderId: string) {
  const owner = (await client.query('SELECT customer_id,subscription_id FROM orders WHERE id=$1', [orderId])).rows[0]
  if (!owner) return
  await client.query('SELECT id FROM customers WHERE id=$1 FOR UPDATE', [owner.customer_id])
  await client.query('SELECT id FROM subscriptions WHERE id=$1 FOR UPDATE', [owner.subscription_id])
}

const logCode = (error: unknown) => (error as { code?: string } | null)?.code ?? (error as Error | null)?.constructor?.name ?? 'error'

async function writeAudit(db: Queryable, action: string, subject: string, reason: string, metadata: Record<string, unknown>) {
  await db.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), 'system', action, subject, reason, JSON.stringify(metadata)])
}

/** A secret for one intent's callback: 192 random bits, never shown to any view, session or log. */
export const newCallbackSecret = () => randomBytes(24).toString('base64url')
/** The callback URL of an intent: the attempt's own URL plus the intent's secret. */
export function callbackWithSecret(attemptUrl: string, secret: string): string {
  const url = new URL(attemptUrl)
  url.searchParams.set(CALLBACK_SECRET_PARAM, secret)
  return url.toString()
}

/**
 * Reasons that can change by themselves: the webhook of a payment can arrive before its intent reads as fulfilled, or before the
 * payment can be read at all. They are answered so that the provider retries, and nothing is written or remembered for them.
 */
const TRANSIENT_REJECTIONS: ReadonlySet<FormRejection> = new Set(['intent_not_fulfilled', 'payment_not_found'])
/** What a payment id that no one can mean (not an id at all) costs: a row of its own kind, outside the money budget. */
const TRIVIAL_REJECTIONS: ReadonlySet<FormRejection> = new Set(['bad_shape'])

/**
 * A payment that could not be tied to its attempt changes nothing. The audit event names the attempt, the order and the payment so the
 * operator can find money that arrived and settled nothing; `form_hint_rejected` is the browser's hint, `form_payment_rejected` a payment
 * the provider itself reported. A repeat (same action, payment, reason and attempt) adds no row. Only permanent reasons are written (see
 * `TRANSIENT_REJECTIONS`); a subject (an order) that has used its hourly budget gets no more rows that hour, and one `form_rejection_suppressed`
 * row says so. No untrusted text goes into the row: only the reason code and ids of a bounded shape.
 */
export async function rejectFormPayment(db: Queryable, source: FormSource, reason: FormRejection, ids: { attempt_id?: string; order_id?: string; payment_id?: string }) {
  const result = { outcome: 'rejected' as const, reason }
  if (TRANSIENT_REJECTIONS.has(reason)) return result
  const paymentId = ids.payment_id && PAYMENT_HINT.test(ids.payment_id) ? ids.payment_id : null
  const action = REJECTION_ACTION[source]
  const subject = ids.order_id ?? ids.attempt_id ?? 'unattributed'
  const trivial = TRIVIAL_REJECTIONS.has(reason)
  const written = await db.query(`INSERT INTO audit_events(id,actor,action,subject,reason,metadata)
    SELECT $1,'system',$2,$3,$4,$5::jsonb
    WHERE NOT EXISTS (SELECT 1 FROM audit_events WHERE action=$2 AND metadata->>'payment_id' IS NOT DISTINCT FROM $6 AND metadata->>'reason'=$7 AND metadata->>'attempt_id' IS NOT DISTINCT FROM $8)
      AND (SELECT count(*) FROM audit_events WHERE action=$2 AND created_at > now() - interval '1 hour'
        AND (metadata->>'reason' = ANY($10::text[])) = $11 AND ($11 OR subject=$3)) < $9
    RETURNING id`,
  [randomUUID(), action, subject, `Card form payment not accepted: ${reason}`,
    JSON.stringify({ reason, attempt_id: ids.attempt_id ?? null, payment_id: paymentId }), paymentId, reason, ids.attempt_id ?? null,
    trivial ? TRIVIAL_REJECTION_HOURLY_BUDGET : REJECTION_SUBJECT_HOURLY_BUDGET, [...TRIVIAL_REJECTIONS], trivial])
  if (!written.rowCount && !(await alreadyRejected(db, action, paymentId, reason, ids.attempt_id ?? null)) && !trivial) {
    await db.query(`INSERT INTO audit_events(id,actor,action,subject,reason,metadata)
      SELECT $1,'system',$2,$3,'Card form rejections of this order are no longer written this hour',$4::jsonb
      WHERE NOT EXISTS (SELECT 1 FROM audit_events WHERE action=$2 AND subject=$3 AND created_at > now() - interval '1 hour')`,
    [randomUUID(), REJECTION_SUPPRESSED_ACTION, subject, JSON.stringify({ source, last_reason: reason })])
  }
  return result
}

const alreadyRejected = async (db: Queryable, action: string, paymentId: string | null, reason: string, attemptId: string | null) =>
  (await db.query(`SELECT 1 FROM audit_events WHERE action=$1 AND metadata->>'payment_id' IS NOT DISTINCT FROM $2 AND metadata->>'reason'=$3 AND metadata->>'attempt_id' IS NOT DISTINCT FROM $4`,
    [action, paymentId, reason, attemptId])).rowCount

/** True when this payment id was rejected a moment ago for a permanent reason: the provider is not asked again. Nothing here depends on how many other payments were rejected. */
async function rejectionMemory(db: Queryable, source: FormSource, paymentId: string): Promise<boolean> {
  const remembered = await db.query(`SELECT 1 FROM audit_events WHERE action=$1 AND metadata->>'payment_id'=$2 AND created_at > now() - make_interval(mins => $3) LIMIT 1`,
    [REJECTION_ACTION[source], paymentId, REJECTION_MEMORY_MINUTES])
  return (remembered.rowCount ?? 0) > 0
}

/** The callback URL a payment must carry: the one the provider locked into this attempt's current intent, which holds this attempt's current secret. */
function callbackMatches(callbackUrl: string | null, intentCallback: string, attempt: Row): boolean {
  if (callbackUrl === null || !attempt.callback_secret || callbackUrl !== intentCallback) return false
  let url: URL
  try { url = new URL(callbackUrl) } catch { return false }
  if (url.pathname !== '/api/commercial/payment-callback' || [...url.searchParams.keys()].sort().join() !== ['attempt', CALLBACK_SECRET_PARAM].sort().join()) return false
  if (url.searchParams.get('attempt') !== attempt.id) return false
  const given = Buffer.from(url.searchParams.get(CALLBACK_SECRET_PARAM) ?? ''), want = Buffer.from(attempt.callback_secret)
  return given.length === want.length && timingSafeEqual(given, want)
}

/**
 * Every check a fetched payment must pass before it may settle (or decline) an attempt. It returns the first failing reason, or null.
 * - the attempt is a form attempt of this provider and mode, and the payment was read with this mode's key;
 * - the locked description names this attempt;
 * - amount, currency and exponent equal the row;
 * - the attempt's current intent, read back with the secret key, is fulfilled (an intent nobody fulfilled has no payment);
 * - the payment's callback URL is exactly the intent's and holds this attempt's current secret. The description and the plain callback
 *   are derivable by anyone who knows the attempt id, and a payment made straight with the public key may carry anything; the secret
 *   reaches only the payer's browser, so a payment made another way cannot reproduce it;
 * - the payment is not already the reference of another attempt.
 * Paid status is the caller's, because only a paid or failed payment is worth checking.
 */
export async function checkFormPayment(db: Queryable, adapter: PaymentAdapter, attempt: Row, record: PaymentRecord): Promise<FormRejection | null> {
  if (attempt.kind !== 'form') return 'not_form_attempt'
  if (attempt.provider !== adapter.provider || attempt.mode !== adapter.mode || record.live !== (adapter.mode === 'live')) return 'mode_mismatch'
  if (record.attempt_id !== attempt.id) return 'attempt_mismatch'
  const same = (m: { minor: number; currency: string; exponent: number }) => m.minor === Number(attempt.amount_minor) && m.currency === attempt.currency && m.exponent === attempt.exponent
  if (!same(record.amount)) return 'amount_mismatch'
  const intent = await readIntent(adapter, attempt.provider_intent_ref)
  if (!intent) return 'intent_missing'
  if (!same(intent.amount)) return 'amount_mismatch'
  // `created` (or a status nobody recognises) may still become fulfilled, so that is transient; a cancelled or expired intent never will.
  if (intent.status === 'canceled' || intent.status === 'expired') return 'intent_closed'
  if (intent.status !== 'fulfilled') return 'intent_not_fulfilled'
  if (!callbackMatches(record.callback_url, intent.callback_url, attempt)) return 'callback_mismatch'
  const elsewhere = await db.query('SELECT 1 FROM payment_attempts WHERE provider=$1 AND provider_ref=$2 AND id<>$3', [attempt.provider, record.payment_id, attempt.id])
  return elsewhere.rowCount ? 'payment_bound_elsewhere' : null
}

/** What to do with the card token of a payment, read before the settlement transaction because reading a token is a provider call. */
export type CardPlan =
  | { kind: 'none' }
  /** The attempt asked to keep the card and the token is active with complete display facts. */
  | { kind: 'save'; token: string; brand: string; last_four: string; exp_month: number; exp_year: number; funding: string | null }
  /** The payment carries a token that must not be kept: it was not asked for, or it is unusable. */
  | { kind: 'discard'; token: string; reason: 'not_requested' | 'token_not_active' | 'token_read_failed' | 'token_details_incomplete' }
  /** The attempt asked to keep the card but the payment has no token. */
  | { kind: 'missing_token' }

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

/** What the settlement does with the card: the single decision that the audit trail, the token deletion and the saved card all follow. */
export type CardDecision =
  | { kind: 'save'; card: Extract<CardPlan, { kind: 'save' }> }
  | { kind: 'discard'; token: string; reason: string }
  | { kind: 'nothing'; reason: string | null }

/** `keep` is whether this payment is the one that paid the order: a duplicate, a payment being returned or a replay keeps no card. */
export function decideCard(plan: CardPlan, keep: boolean): CardDecision {
  if (plan.kind === 'none') return { kind: 'nothing', reason: null }
  if (plan.kind === 'missing_token') return { kind: 'nothing', reason: keep ? 'token_missing' : null }
  if (plan.kind === 'discard') return { kind: 'discard', token: plan.token, reason: plan.reason }
  return keep ? { kind: 'save', card: plan } : { kind: 'discard', token: plan.token, reason: 'payment_not_kept' }
}

type TokenOwner = { customer_id: string; payment_method_id?: string; card?: { brand: string; last_four: string } }

/** A durable request to delete a card token at the provider. The token stays on the row only until the deletion is done or given up. */
async function enqueueTokenDeletion(client: PoolClient, attempt: Row, token: string, aggregateId: string, dedupe: string, owner: TokenOwner) {
  await enqueueOutbox(client, { kind: TOKEN_DELETE_KIND, aggregate_id: aggregateId, dedupe_key: dedupe, payload: { provider: attempt.provider, mode: attempt.mode, token, ...owner } })
}

/** Keeps the card: it becomes the customer's default (the previous default is removed and its token queued for deletion) and auto-renew is switched on with the attempt's consent. */
async function saveCard(client: PoolClient, order: Row, attempt: Row, card: Extract<CardPlan, { kind: 'save' }>): Promise<'saved' | 'token_already_saved'> {
  const previous = (await client.query("SELECT id,provider_token,brand,last_four FROM payment_methods WHERE customer_id=$1 AND is_default AND status='active' FOR UPDATE", [order.customer_id])).rows[0]
  if (previous?.provider_token === card.token) return 'token_already_saved'
  if (previous) {
    await client.query("UPDATE payment_methods SET status='removed',is_default=false,removed_at=now(),removed_by='system' WHERE id=$1", [previous.id])
    await enqueueTokenDeletion(client, attempt, previous.provider_token, previous.id, 'replaced',
      { customer_id: order.customer_id, payment_method_id: previous.id, card: { brand: previous.brand, last_four: previous.last_four } })
  }
  const saved = await client.query(`INSERT INTO payment_methods(id,customer_id,provider,mode,provider_token,brand,last_four,exp_month,exp_year,funding,status,is_default,
      consent_at,consent_text_version,source_attempt_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',true,$11,$12,$13,$14)
      ON CONFLICT ON CONSTRAINT payment_methods_token_unique DO NOTHING RETURNING id`,
  [randomUUID(), order.customer_id, attempt.provider, attempt.mode, card.token, card.brand, card.last_four, card.exp_month, card.exp_year, card.funding, attempt.consent_at, attempt.consent_text_version, attempt.id, attempt.opened_by])
  if (!saved.rowCount) return 'token_already_saved'
  await writeAudit(client, 'payment_method.saved', order.customer_id, 'Card saved from a card form payment',
    { payment_method_id: saved.rows[0].id, attempt_id: attempt.id, brand: card.brand, last_four: card.last_four })
  // Auto-renew is switched on only where nothing will charge the card against the customer's will: not while the subscription is being dropped to the free base or deleted.
  const held = (await client.query(`SELECT ${holdsFreeBaseLockSql('s')} AS lock,${deletionClockRunningSql('s.customer_id')} AS deleting FROM subscriptions s WHERE s.id=$1`, [order.subscription_id])).rows[0]
  if (held.lock || held.deleting) {
    await writeAudit(client, 'auto_renew.not_enabled', order.subscription_id, 'The card was saved but automatic renewal stays off',
      { attempt_id: attempt.id, reason: held.deleting ? 'workspace_deletion' : 'free_base_lock' })
    return 'saved'
  }
  const enabled = await client.query(`UPDATE subscriptions SET auto_renew_enabled=true,auto_renew_consent_at=$2,revision=revision+1
    WHERE id=$1 AND NOT auto_renew_enabled RETURNING id`, [order.subscription_id, attempt.consent_at])
  if (enabled.rowCount) await writeAudit(client, 'auto_renew.enabled', order.subscription_id, 'Auto-renew enabled with the card saved at payment',
    { attempt_id: attempt.id, consent_text_version: attempt.consent_text_version })
  return 'saved'
}

/**
 * Carries out the card decision of a payment inside its settlement transaction. Saving the card runs under a savepoint: whatever goes
 * wrong with it (a constraint, a concurrent default) rolls back to the savepoint, the payment still settles, the card is not kept, and its
 * token is queued for deletion. The caller has already locked the order, the attempt and the customer, in that order.
 */
export async function applyCardDecision(client: PoolClient, order: Row, attempt: Row, event: ProviderEvent, decision: CardDecision, settled: boolean, authenticated: boolean | null) {
  if (settled) await writeAudit(client, 'payment.form_settled', order.id, 'Card form payment settled', { attempt_id: attempt.id, payment_id: event.payment_id, authenticated, card: decision.kind })
  const owner: TokenOwner = { customer_id: order.customer_id }
  const discard = async (token: string, reason: string, action = 'payment.card_not_saved', words = 'The card was not saved') => {
    await enqueueTokenDeletion(client, attempt, token, attempt.id, 'discarded', owner)
    await writeAudit(client, action, order.id, words, { attempt_id: attempt.id, reason })
  }
  if (decision.kind === 'nothing') {
    if (decision.reason) await writeAudit(client, 'payment.card_not_saved', order.id, 'The card was not saved', { attempt_id: attempt.id, reason: decision.reason })
  } else if (decision.kind === 'discard') {
    if (decision.reason === 'not_requested') await discard(decision.token, decision.reason, 'payment.token_orphan_deleted', 'The payment carried a card token that was not asked for; it is being deleted')
    else await discard(decision.token, decision.reason)
  } else {
    await client.query('SAVEPOINT card_save')
    let outcome: 'saved' | 'token_already_saved' | 'failed'
    try {
      outcome = await saveCard(client, order, attempt, decision.card)
      await client.query('RELEASE SAVEPOINT card_save')
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT card_save')
      await client.query('RELEASE SAVEPOINT card_save')
      console.error('[payments] the card of attempt %s could not be saved (%s)', attempt.id, logCode(error))
      outcome = 'failed'
    }
    if (outcome === 'failed') await discard(decision.card.token, 'card_save_failed')
    // The same token is already a saved card: it must not be deleted, only reported.
    else if (outcome === 'token_already_saved') await writeAudit(client, 'payment.card_not_saved', order.id, 'The card was not saved', { attempt_id: attempt.id, reason: 'token_already_saved' })
  }
}

/** The plan flag that lets a customer keep a card for renewal: read from the plan a subscription revision was sold under. */
export async function assertAutoRenewAllowed(client: Queryable, revisionId: string) {
  const plan = (await client.query(`SELECT p.auto_renew_allowed FROM subscription_revisions r
    JOIN plan_revisions p ON p.id::text = r.snapshot->>'plan_revision_id' WHERE r.id=$1`, [revisionId])).rows[0]
  if (!plan?.auto_renew_allowed) throw new CommercialHttpError('auto_renew_not_allowed', 409)
}

export type FormResolution =
  | { outcome: 'settled' | 'ignored' | 'declined' }
  | { outcome: 'not_paid'; status: PaymentRecord['status'] }
  | { outcome: 'rejected'; reason: FormRejection }

/** The settlement the caller owns (`apply` in payments.ts), given so that this module stays below it. */
export type SettleInTransaction = (client: PoolClient, event: ProviderEvent) => Promise<'accepted' | 'ignored' | 'rejected'>

/**
 * Turns a payment id that nothing vouches for into a settled attempt, a recorded decline, or nothing. The payment is fetched with the
 * secret key and must name an existing form attempt (`expect`, when the caller knows which, is the only one it may name) and pass
 * `checkFormPayment`. Binding the payment to the attempt and settling it is one transaction under the order, attempt and customer
 * locks, so a callback and a webhook racing for the same payment settle it once. A payment on a closed attempt settles as a late
 * payment, or as a duplicate charge when the order was paid meanwhile; a second payment on an attempt that already has one is refused.
 * Only paid payments are audited when refused (they are money); a failed or pending payment that does not belong changes nothing.
 */
export async function resolveFormPayment(pool: Pool, adapter: PaymentAdapter, input: { payment_id: string; source: FormSource; expect?: Row; event_id?: string; settle: SettleInTransaction }): Promise<FormResolution> {
  const reject = (reason: FormRejection, ids: { attempt_id?: string; order_id?: string } = {}) => rejectFormPayment(pool, input.source, reason, { ...ids, payment_id: input.payment_id })
  if (!isPaymentHint(input.payment_id)) return reject('bad_shape', { attempt_id: input.expect?.id, order_id: input.expect?.order_id })
  if (await rejectionMemory(pool, input.source, input.payment_id)) return { outcome: 'rejected', reason: 'rate_limited' }
  let record: PaymentRecord
  try { record = await adapter.readPayment(input.payment_id) } catch (error) {
    if (error instanceof PaymentError && error.code === 'not_found') return reject('payment_not_found', { attempt_id: input.expect?.id, order_id: input.expect?.order_id })
    throw error
  }
  if (record.status === 'refunded') {
    // A payment nobody claimed that was refunded in full has returned its money and owes nothing. One refunded in part still holds money the
    // control plane has no order for, so it is audited like any other unmatched payment.
    const kept = record.amount.minor - (record.refunded?.minor ?? record.amount.minor)
    if (kept <= 0) {
      // The money is back: the fact that ends any attention item for this payment (an earlier rejection of it needed the operator).
      await pool.query(`INSERT INTO audit_events(id,actor,action,subject,reason,metadata) SELECT $1,'system',$2,$3,'Card form payment refunded in full',$4::jsonb
        WHERE NOT EXISTS (SELECT 1 FROM audit_events WHERE action=$2 AND metadata->>'payment_id'=$3)`, [randomUUID(), FORM_PAYMENT_REFUNDED_ACTION, input.payment_id, JSON.stringify({ payment_id: input.payment_id })])
      return { outcome: 'not_paid', status: record.status }
    }
    const owner = record.attempt_id ? (await pool.query('SELECT id,order_id FROM payment_attempts WHERE id=$1', [record.attempt_id])).rows[0] : undefined
    return reject('refunded_unclaimed', { attempt_id: owner?.id, order_id: owner?.order_id })
  }
  if (record.status !== 'succeeded' && record.status !== 'failed') return { outcome: 'not_paid', status: record.status }
  // A refusal of a payment that is not paid costs nothing, so it leaves no trace; a paid one is money and is audited.
  const refuse = (reason: FormRejection, ids: { attempt_id?: string; order_id?: string } = {}): FormResolution | Promise<FormResolution> =>
    record.status === 'succeeded' ? reject(reason, ids) : { outcome: 'not_paid', status: record.status }
  if (!record.attempt_id) return refuse('description_unrecognized', { attempt_id: input.expect?.id, order_id: input.expect?.order_id })
  if (input.expect && record.attempt_id !== input.expect.id) return refuse('attempt_mismatch', { attempt_id: input.expect.id, order_id: input.expect.order_id })
  const attempt = (await pool.query('SELECT * FROM payment_attempts WHERE id=$1', [record.attempt_id])).rows[0]
  if (!attempt) return refuse('attempt_unknown')
  const reason = await checkFormPayment(pool, adapter, attempt, record)
  if (reason) return refuse(reason, { attempt_id: attempt.id, order_id: attempt.order_id })
  if (record.status === 'failed') return recordDecline(pool, attempt, record)
  const plan = await planCard(adapter, attempt, record)
  let result: FormResolution | { outcome: 'refused'; reason: FormRejection }
  try {
    result = await transaction(pool, async client => {
      await lockSettlement(client, attempt.order_id)
      const order = (await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [attempt.order_id])).rows[0]
      const current = (await client.query('SELECT * FROM payment_attempts WHERE id=$1 FOR UPDATE', [attempt.id])).rows[0]
      if (current.provider_ref === record.payment_id) return { outcome: 'ignored' as const }
      if (current.provider_ref) return { outcome: 'refused' as const, reason: 'attempt_has_other_payment' as const }
      await client.query('UPDATE payment_attempts SET provider_ref=$2,updated_at=now() WHERE id=$1', [current.id, record.payment_id])
      const target = { ...current, provider_ref: record.payment_id }
      const event = formPaymentEvent(adapter, record, target.id, input.event_id)
      const outcome = await input.settle(client, event)
      // The binding and the settlement are one: a refusal rolls the binding back, so a payment that settled nothing is bound to nothing.
      if (outcome === 'rejected') throw new SettlementRefused('settlement_mismatch')
      const after = (await client.query('SELECT payment_state,paid_attempt_id FROM orders WHERE id=$1', [order.id])).rows[0]
      const keep = outcome === 'accepted' && after.paid_attempt_id === target.id && after.payment_state === 'paid'
      const decision = decideCard(plan, keep)
      if (outcome === 'accepted' || decision.kind === 'discard') await applyCardDecision(client, order, target, event, decision, outcome === 'accepted', record.authenticated)
      return { outcome: outcome === 'accepted' ? 'settled' as const : 'ignored' as const }
    })
  } catch (error) {
    if (error instanceof SettlementRefused) result = { outcome: 'refused', reason: error.reason }
    // Another settlement took this payment id between the check and the update: the same refusal, typed.
    else if ((error as { code?: string }).code === '23505' && (error as { constraint?: string }).constraint === 'payment_attempts_provider_ref') result = { outcome: 'refused', reason: 'payment_bound_elsewhere' }
    else throw error
  }
  if (result.outcome === 'refused') return reject(result.reason, { attempt_id: attempt.id, order_id: attempt.order_id })
  // After the commit, never inside it: the provider call that deletes a replaced or unwanted token holds no lock. A failure stays queued.
  if (result.outcome === 'settled') await processTokenDeletions(pool, adapter)
  return result
}

/** A failed payment of the attempt's current intent: the intent is consumed and nothing was charged, so the attempt may open a fresh one at once. */
async function recordDecline(pool: Pool, attempt: Row, record: PaymentRecord): Promise<FormResolution> {
  await transaction(pool, async client => {
    const marked = await client.query(`UPDATE payment_attempts SET declined_payment_ref=$2,updated_at=now()
      WHERE id=$1 AND provider_ref IS NULL AND declined_payment_ref IS DISTINCT FROM $2 RETURNING order_id`, [attempt.id, record.payment_id])
    if (marked.rowCount) await writeAudit(client, 'payment.form_declined', attempt.order_id, 'Card form payment declined', { attempt_id: attempt.id, payment_id: record.payment_id })
  })
  return { outcome: 'declined' }
}

/** The event the settlement machine takes, built from the payment the provider reported: its id is the provider reference of a form attempt. */
export function formPaymentEvent(adapter: PaymentAdapter, record: PaymentRecord, attemptId: string, eventId?: string): ProviderEvent {
  return {
    provider: adapter.provider, event_id: eventId ?? `lookup:${record.payment_id}:${record.provider_status}`, provider_ref: record.payment_id, payment_id: record.payment_id,
    attempt_id: attemptId, merchant_account: adapter.merchantAccount, live: record.live, status: record.status, amount: record.amount,
    ...(record.refunded ? { refunded: record.refunded } : {}), occurred_at: new Date().toISOString(), raw_type: `payment_${record.provider_status}`,
  }
}

/** What the browser is given to open the card form. The client secret is read from the provider each time; it is never stored. The callback secret is never part of it. */
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

/**
 * An intent that was fulfilled (or is in a state nobody recognises) may hold a payment, paid or still being authenticated, that nothing can
 * look up from the attempt alone. Only a decline the provider reported for this intent's payment (`declined_payment_ref`) says it does not.
 * One that was never fulfilled holds none: cancelled, or expired (`created` past its end, as the adapter reports it).
 */
export function intentMayHoldPayment(row: Row, intent: PaymentIntent | null): boolean {
  return !!intent && intent.status !== 'created' && intent.status !== 'canceled' && intent.status !== 'expired' && !row.declined_payment_ref
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
 * Closes a form attempt nobody paid, locally and at the provider. The order stays payable. A payment that shows up afterwards is still
 * found by its description and secret and settled as a late payment, so closing never loses money. At the end of its lifetime the intent
 * is read first: one that was fulfilled with no payment ever reported (no webhook, no return) may hold money, so the attempt is closed
 * with `payment.form_attempt_needs_review` and the vendor looks the payment up at the provider.
 */
export async function closeUnpaidFormAttempt(pool: Pool, adapter: PaymentAdapter, row: Row, reason: 'expired' | 'method_changed' | 'order_paid') {
  const intent = reason === 'expired' ? await readIntent(adapter, row.provider_intent_ref) : null
  const review = reason === 'expired' && intentMayHoldPayment(row, intent)
  if (!review) await cancelIntentQuietly(adapter, row.provider_intent_ref)
  await transaction(pool, async client => {
    // A closed attempt whose intent may hold a payment keeps the saved card from being charged for the same invoice while that payment may still arrive.
    const closed = await client.query(`UPDATE payment_attempts SET status='canceled',updated_at=now(),
        payment_hold_until=CASE WHEN $3 THEN now() + make_interval(hours => $4) END WHERE id=$1 AND provider_ref IS NULL AND status = ANY($2::text[]) RETURNING order_id`,
    [row.id, LIVE_ATTEMPT_STATUSES, review, FORM_PAYMENT_HOLD_HOURS])
    if (!closed.rowCount) return
    await writeAudit(client, 'payment.form_attempt_closed', row.order_id, `Unpaid card form attempt closed: ${reason}`, { attempt_id: row.id, reason })
    if (review) await writeAudit(client, 'payment.form_attempt_needs_review', row.order_id, 'The card form was used but no payment was reported: look the payment up at the provider',
      { attempt_id: row.id, intent_status: intent?.status ?? null })
  })
}

/**
 * The customer asks for another way to pay while a form attempt is open. It is closed only when no payment can exist for it: the intent
 * was never fulfilled (it is cancelled here, and a refusal means it was fulfilled in the meantime), never created, or its payment is
 * known to have been declined.
 */
export async function retireLiveFormAttempt(pool: Pool, adapter: PaymentAdapter, row: Row) {
  if (row.provider_ref) throw new CommercialHttpError('payment_in_progress', 409)
  const intent = await readIntent(adapter, row.provider_intent_ref)
  if (intentMayHoldPayment(row, intent)) throw new CommercialHttpError('payment_in_progress', 409)
  // An intent past its expiry was never fulfilled (a fulfilled one reads `fulfilled`), so cancelling it cannot meet a payment.
  if (intent?.status === 'created' && new Date(intent.expires_at).getTime() > Date.now() && await adapter.cancelIntent(intent.id) === 'not_cancelable')
    throw new CommercialHttpError('payment_in_progress', 409)
  await closeUnpaidFormAttempt(pool, adapter, row, 'method_changed')
}

/**
 * Deletes card tokens at the provider: the default card a new card replaced, and a token that came with a payment that did not keep it.
 * A failure is logged by code, leaves the row pending and is retried with backoff. A deletion that keeps failing (a day, or twelve tries)
 * is given up: the row fails with the token stripped, the removed card forgets its token, and the vendor sees the card (brand and last four).
 */
export async function processTokenDeletions(pool: Pool, adapter: PaymentAdapter | undefined, limit = 20): Promise<number> {
  let deleted = 0
  for (const row of await claimOutbox(pool, [TOKEN_DELETE_KIND], limit)) {
    const payload = row.payload as { provider: string; mode: string; token: string; payment_method_id?: string }
    if (!adapter || adapter.provider !== payload.provider || adapter.mode !== payload.mode) { await releaseOutbox(pool, row.id); continue }
    const forgetToken = (db: Queryable) => payload.payment_method_id
      ? db.query("UPDATE payment_methods SET provider_token=NULL WHERE id=$1 AND status='removed'", [payload.payment_method_id]) : Promise.resolve()
    try {
      await adapter.deleteToken(payload.token)
      await transaction(pool, async client => {
        await client.query("UPDATE commercial_outbox SET status='done',processed_at=now(),payload=payload-'token' WHERE id=$1 AND status='pending'", [row.id])
        await forgetToken(client)
      })
      deleted++
    } catch (error) {
      const code = logCode(error)
      console.error(JSON.stringify({ event: 'payment_token_delete_failed', outbox_id: row.id, code }))
      const tooOld = Date.now() - new Date(row.created_at).getTime() > TOKEN_DELETE_MAX_AGE_HOURS * 3_600_000
      if (row.attempts + 1 >= TOKEN_DELETE_MAX_ATTEMPTS || tooOld) {
        await transaction(pool, async client => {
          await client.query("UPDATE commercial_outbox SET status='failed',processed_at=now(),payload=(payload-'token')||jsonb_build_object('error',$2::text) WHERE id=$1 AND status='pending'", [row.id, code])
          await forgetToken(client)
        })
      } else await deferOutbox(pool, row.id, code)
    }
  }
  return deleted
}
