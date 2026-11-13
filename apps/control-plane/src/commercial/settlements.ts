import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { z } from 'zod'
import { transaction } from '../db.js'
import { daysBetween, riyadhDate, type RefundCreditNoteRequest } from '@liwan/commercial-contracts'
import { audit, CommercialHttpError, type CommercialActor } from './lifecycle.js'
import { adjustmentView } from './invoices.js'
import type { PaymentAdapter, ProviderEvent } from './payment-adapter.js'
import { actorLabel } from '../admin-auth/grants.js'
import { billingSettings } from './billing-settings.js'
import { claimOutbox, completeOutbox, deferOutbox, enqueueOutbox } from './outbox.js'
import { creditedMinorSql, type CreditNoteCause } from './refund-credit.js'
import { assertTopupUnused, markTopupRefunded } from './ai-ledger.js'
import { armRefundLock } from './free-base-lock.js'

/** The `payment_attempts.provider` of money received by bank transfer: there is no provider payment to refund. */
const BANK_TRANSFER_PROVIDER = 'bank_transfer'
/** Refunds the provider cannot do for this payment: retrying changes nothing, so the row goes to the operator at once. */
const NON_RETRYABLE_REFUND = ['provider_refund_unavailable', 'provider_refund_payment_mismatch', 'refund_note_unavailable']
/** Tries of one automatic provider refund (1, 2, 4, 8, 16 minute backoff between them) before the operator takes over. */
const AUTOMATIC_REFUND_ATTEMPTS = 6
const MANUAL_REVIEW_REASON = 'payment after cancellation — manual review'
/** Human explanation of a duplicate-charge note; the kind itself is its `duplicate_payment` cause. */
const DUPLICATE_PAYMENT_REASON = 'duplicate payment — manual review'

export async function processRefundOutbox(pool: Pool, adapter?: PaymentAdapter): Promise<number> {
  let automatic = 0
  for (const row of await claimOutbox(pool, ['reconcile.refund'], 20, { automatic: true })) {
    try {
      await refundThroughProvider(pool, adapter, row)
      automatic++
    } catch (error) {
      const code = error instanceof Error ? error.message : 'provider_refund_failed'
      try {
        // A row that may hold returned money is never handed over (see handOffAutomaticRefund): it keeps retrying with backoff.
        if ((NON_RETRYABLE_REFUND.includes(code) || row.attempts + 1 >= AUTOMATIC_REFUND_ATTEMPTS) && await handOffAutomaticRefund(pool, row, code)) automatic++
        else await deferOutbox(pool, row.id, code)
      } catch (handOffError) {
        console.error(JSON.stringify({ event: 'commercial_refund_handoff_failed', outbox_id: row.id, error: String(handOffError instanceof Error ? handOffError.message : handOffError).slice(0, 200) }))
        await deferOutbox(pool, row.id, code)
      }
    }
  }
  return automatic + await transaction(pool, async client => {
    const rows = (await client.query("SELECT * FROM commercial_outbox WHERE kind IN ('reconcile.refund','payment.intervention') AND status='pending' AND payload->>'automatic' IS DISTINCT FROM 'true' ORDER BY created_at,id FOR UPDATE SKIP LOCKED")).rows
    const reason = MANUAL_REVIEW_REASON
    for (const row of rows) {
      let rejected: string | null = null
      if (row.kind === 'payment.intervention') rejected = await creditRefundedAfterFulfillment(client, row.payload)
      else if (row.payload?.duplicate) rejected = await creditDuplicatePayment(client, row.payload.attempt_id)
      else {
        // Lock invoices too: separate event ids can refer to the same invoice.
        const invoices = (await client.query('SELECT * FROM invoices WHERE order_id=$1 ORDER BY id FOR UPDATE', [row.aggregate_id])).rows
        for (const invoice of invoices) {
          const existing = await client.query("SELECT id FROM invoice_adjustments WHERE invoice_id=$1 AND cause='payment_after_cancellation'", [invoice.id])
          if (!existing.rowCount) await insertSystemCreditNote(client, invoice, 'payment_after_cancellation', reason, { minor: invoice.total_minor, currency: invoice.currency, exponent: invoice.exponent })
        }
      }
      if (rejected) await rejectOutboxRow(client, row, rejected)
      else await client.query("UPDATE commercial_outbox SET status='done',processed_at=now() WHERE id=$1", [row.id])
    }
    return rows.length
  })
}

const AUTOMATIC_CREDIT = 'Payment returned after an undelivered trial order'
/** The `refunded_by` of a refund the system made through the provider. */
const SYSTEM_REFUNDER = 'system'
/**
 * The payload of a `reconcile.refund` row the worker refunds through the provider. `adjustment_id` and `requested_by` mark a
 * vendor-requested refund. `provider_refund` is what the worker knows of the provider's side, written in its own committed
 * write so a rolled-back recording cannot forget it: `attempted` (a refund call was made and its outcome is not verified: money
 * may have left) or `returned` (the provider returned the whole payment, `provider_payment_id`). Absent means nothing was asked.
 */
type RefundOutboxPayload = { attempt_id?: string; payment_id?: string; automatic?: boolean; adjustment_id?: string; requested_by?: CommercialActor
  provider_refund?: 'attempted' | 'returned'; provider_payment_id?: string }

/**
 * An automatic refund that cannot finish is closed as failed with its reason; the row keeps its payload, which trial
 * recovery reads as proof. When the failure is proven to come before any refund (no adapter, or a code in
 * NON_RETRYABLE_REFUND) it also becomes the manual review the operator already works: one pending credit note for what
 * the attempt paid and is not yet credited (an undelivered order already has its fulfilment note, so it gets none more).
 * Recording the refund on the note settles the order. Any other code (retries used up on a timeout or a provider error) with
 * no refund ever asked of the provider writes no note: the failed row shows in the attention list as refund_rejected and the
 * operator may refund by hand. A row with `provider_refund` set (money returned, or a refund call whose outcome is unverified)
 * is never handed over, whatever the code: the customer could be paid twice. It returns false and stays pending.
 */
async function handOffAutomaticRefund(pool: Pool, row: { id: string; kind: string; aggregate_id: string; payload: unknown }, reason: string): Promise<boolean> {
  return transaction(pool, async client => {
    const current = (await client.query("SELECT payload->>'provider_refund' AS provider_refund FROM commercial_outbox WHERE id=$1 AND status='pending' FOR UPDATE", [row.id])).rows[0]
    if (!current) return true
    if (current.provider_refund) return false
    const attemptId = (row.payload as { attempt_id?: string }).attempt_id
    const attempt = typeof attemptId === 'string' && z.uuid().safeParse(attemptId).success ? (await client.query(`SELECT a.* FROM payment_attempts a
      JOIN orders o ON o.id=a.order_id WHERE a.id=$1 AND o.id::text=$2 AND o.payment_state='refund_pending' AND o.paid_attempt_id=a.id`, [attemptId, row.aggregate_id])).rows[0] : undefined
    if (attempt && NON_RETRYABLE_REFUND.includes(reason)) {
      const invoice = (await client.query('SELECT id,customer_id FROM invoices WHERE id=$1 FOR UPDATE', [attempt.invoice_id])).rows[0]
      const credited = Number((await client.query(`SELECT ${creditedMinorSql('$1')} AS amount`, [invoice.id])).rows[0].amount)
      if (credited < Number(attempt.amount_minor))
        await insertSystemCreditNote(client, invoice, 'payment_after_cancellation', MANUAL_REVIEW_REASON, { minor: Number(attempt.amount_minor) - credited, currency: attempt.currency, exponent: attempt.exponent })
    }
    await rejectOutboxRow(client, { id: row.id, kind: row.kind, aggregate_id: row.aggregate_id }, reason)
    return true
  })
}

/**
 * Returns a card payment through the provider and closes the credit note it serves. Two kinds of row come here: an undelivered
 * order (no `adjustment_id`, the order waits in `refund_pending`) and a vendor-requested refund of a delivered first payment
 * (`adjustment_id` names the pending vendor note, the order stays as it is and the provider's own refund event settles it).
 * Confirm the original payment first. An interrupted refund is reconciled by cumulative provider amount, so a retry, a second
 * worker or a restart asks the provider for nothing it already returned; the advisory lock keeps two workers apart. Once the
 * provider has returned the money that fact is on the row (`provider_refund: 'returned'`) before recording is tried, so a
 * recording that keeps failing is retried without the provider and never counts toward the operator hand-off.
 */
async function refundThroughProvider(pool: Pool, adapter: PaymentAdapter | undefined, row: { id: string; aggregate_id: string; payload: unknown }) {
  const payload = row.payload as RefundOutboxPayload
  const requested = typeof payload.adjustment_id === 'string'
  const knownPaymentId = payload.provider_refund === 'returned' ? payload.provider_payment_id : undefined
  if (!adapter && !knownPaymentId) throw Error('provider_refund_unavailable')
  const lock = await pool.connect()
  let owned = false
  try {
    owned = (await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS held', [`commercial-refund:${row.aggregate_id}`])).rows[0].held
    if (!owned) return
    const attempt = (await lock.query(`SELECT a.*,o.payment_state,i.customer_id,i.total_minor
      FROM payment_attempts a JOIN orders o ON o.id=a.order_id JOIN invoices i ON i.id=a.invoice_id
      WHERE a.id=$1 AND a.order_id::text=$2 AND o.paid_attempt_id=a.id AND ($3::boolean OR o.fulfillment_state<>'applied')`,
    [payload.attempt_id ?? null, row.aggregate_id, requested])).rows[0]
    if (!attempt || !(requested ? ['paid','refunded'] : ['refund_pending','refunded']).includes(attempt.payment_state)) throw Error('refund_attempt_unavailable')
    // A vendor-requested refund returns exactly the invoice: a payment of another amount is for the operator, not for the worker.
    if (requested && Number(attempt.amount_minor) !== Number(attempt.total_minor)) throw Error('provider_refund_payment_mismatch')
    // Before any provider call: the note this refund serves must still be the pending vendor note for the whole invoice. A note
    // already refunded means the money is back (done); one that is void, missing or another note's means no money may leave.
    if (requested) {
      const note = (await lock.query('SELECT kind,origin,status,invoice_id,amount_minor,currency FROM invoice_adjustments WHERE id=$1', [payload.adjustment_id])).rows[0]
      if (note?.status === 'refunded') { await completeOutbox(pool, row.id); return }
      if (note?.status !== 'pending' || note.kind !== 'credit_note' || note.origin !== 'vendor' || note.invoice_id !== attempt.invoice_id
        || Number(note.amount_minor) !== Number(attempt.total_minor) || note.currency !== attempt.currency) throw Error('refund_note_unavailable')
    }
    const paymentId = knownPaymentId ?? await returnPaymentAtProvider(pool, adapter!, row.id, attempt, payload)
    const total = Number(attempt.amount_minor)
    await transaction(pool, async client => {
      if (requested) {
        // The same recording the operator's form runs (free-base lock and audit included), made by the system for the operator who asked.
        const actor = payload.requested_by
        if (!actor) throw Error('refund_requester_missing')
        // A note that is no longer pending was settled meanwhile: the money is returned, so the row is done.
        const current = (await client.query('SELECT status FROM invoice_adjustments WHERE id=$1 FOR UPDATE', [payload.adjustment_id])).rows[0]
        if (current?.status !== 'pending') { await completeOutbox(client, row.id); return }
        await recordRefundIn(client, { adjustment_id: payload.adjustment_id!, actor, refundedBy: SYSTEM_REFUNDER,
          request: { external_reference: paymentId, reason: 'Refunded through the payment provider' }, automatic: true })
        await completeOutbox(client, row.id)
        return
      }
      const invoice = (await client.query('SELECT * FROM invoices WHERE id=$1 FOR UPDATE', [attempt.invoice_id])).rows[0]
      const note = (await client.query(`SELECT id FROM invoice_adjustments WHERE invoice_id=$1 AND kind='credit_note'
        AND status='pending' AND cause='fulfillment_failure' ORDER BY created_at DESC,id LIMIT 1 FOR UPDATE`, [invoice.id])).rows[0]
      // The customer's own pending refund request for the whole invoice is this same money: close it instead of leaving it to be paid twice.
      const vendorNote = note ? undefined : (await client.query(`SELECT id FROM invoice_adjustments WHERE invoice_id=$1 AND kind='credit_note'
        AND status='pending' AND origin='vendor' AND amount_minor=$2 ORDER BY created_at,id LIMIT 1 FOR UPDATE`, [invoice.id, invoice.total_minor])).rows[0]
      if (note || vendorNote) {
        await client.query(`UPDATE invoice_adjustments SET status='refunded',refund_reference=$2,refunded_by='system',refunded_at=now()
          WHERE id=$1`, [(note ?? vendorNote).id, paymentId])
      } else {
        const credited = Number((await client.query(`SELECT ${creditedMinorSql('$1')} AS amount`, [invoice.id])).rows[0].amount)
        if (credited < total) await client.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,
          status,created_by,origin,cause,refund_reference,refunded_at,refunded_by)
          VALUES($1,$2,$3,'credit_note',$4,$5,$6,$7,'refunded','system','system','automatic_refund',$8,now(),'system')`,
        [randomUUID(), invoice.id, invoice.customer_id, AUTOMATIC_CREDIT, total - credited, attempt.currency, attempt.exponent, paymentId])
      }
      await client.query("UPDATE orders SET payment_state='refunded' WHERE id::text=$1 AND payment_state='refund_pending'", [row.aggregate_id])
      await completeOutbox(client, row.id)
    })
  } finally {
    let broken = false
    if (owned) try { await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [`commercial-refund:${row.aggregate_id}`]) }
    catch { broken = true }
    lock.release(broken || undefined)
  }
}

/** Writes what the worker knows of the provider's side onto the row, in its own committed write (never inside the recording transaction). */
async function noteProviderRefund(pool: Pool, outboxId: string, patch: Pick<RefundOutboxPayload, 'provider_refund' | 'provider_payment_id'> | null) {
  await pool.query("UPDATE commercial_outbox SET payload = CASE WHEN $2::jsonb IS NULL THEN payload - 'provider_refund' ELSE payload || $2::jsonb END WHERE id=$1 AND status='pending'",
    [outboxId, patch ? JSON.stringify(patch) : null])
}

/**
 * Makes the provider return the whole payment, asking for only what it has not returned yet, and persists the fact before
 * returning the provider's payment id. The row is marked `attempted` before the refund call. If the call fails and a fresh read
 * proves the provider's refunded figure unchanged, the mark is removed (nothing left, the operator may take over after the
 * retries); any other failure leaves it, because the money may have left.
 */
async function returnPaymentAtProvider(pool: Pool, adapter: PaymentAdapter, outboxId: string, attempt: Record<string, any>, payload: RefundOutboxPayload): Promise<string> {
  if (attempt.provider !== adapter.provider || attempt.mode !== adapter.mode || !attempt.provider_ref) throw Error('provider_refund_unavailable')
  const read = () => attempt.token_charge ? adapter.lookupPayment?.(attempt.provider_ref) : adapter.lookupAttempt(attempt.provider_ref)
  const payment = await read()
  const total = Number(attempt.amount_minor)
  if (!payment?.payment_id || !['succeeded','refunded'].includes(payment.status)
    || payment.amount.minor !== total || payment.amount.currency !== attempt.currency || payment.amount.exponent !== attempt.exponent
    || payment.merchant_account !== adapter.merchantAccount || payment.live !== (adapter.mode === 'live')
    || (payload.payment_id && payload.payment_id !== payment.payment_id)) throw Error('provider_refund_payment_mismatch')
  const refundedOf = (event: ProviderEvent | undefined) => event?.refunded?.minor ?? (event?.status === 'refunded' ? null : 0)
  const returned = refundedOf(payment)
  if (returned === null || returned < 0 || returned > total) throw Error('provider_refund_amount_unverified')
  const fullyReturned = (event: ProviderEvent | undefined) => event?.payment_id === payment.payment_id && event.refunded?.minor === total
    && event.refunded.currency === attempt.currency && event.refunded.exponent === attempt.exponent
  if (returned < total) {
    await noteProviderRefund(pool, outboxId, { provider_refund: 'attempted' })
    let result: Awaited<ReturnType<PaymentAdapter['refund']>> | undefined
    try { result = await adapter.refund(payment.payment_id, { minor: total - returned, currency: attempt.currency, exponent: attempt.exponent }) }
    catch (error) {
      let after: ProviderEvent | undefined
      try { after = await read() } catch { /* unverifiable: the mark stays */ }
      if (!fullyReturned(after)) {
        if (after?.payment_id === payment.payment_id && refundedOf(after) === returned) await noteProviderRefund(pool, outboxId, null)
        throw error
      }
    }
    if (result && (result.payment_id !== payment.payment_id || !fullyReturned(await read()))) throw Error('provider_refund_unverified')
  }
  await noteProviderRefund(pool, outboxId, { provider_refund: 'returned', provider_payment_id: payment.payment_id })
  return payment.payment_id
}

/**
 * A row that cannot become a credit note (a missing attempt, a refund above what was paid) is closed as failed with its
 * reason on the row, in the audit trail the operator reads and in the log, and the rest of the batch goes on: one bad row
 * must never stall every refund behind it.
 */
async function rejectOutboxRow(client: PoolClient, row: { id: string; kind: string; aggregate_id: string }, reason: string) {
  await client.query("UPDATE commercial_outbox SET status='failed',processed_at=now(),payload=payload || jsonb_build_object('error',$2::text) WHERE id=$1", [row.id, reason])
  await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(), 'system', 'payment.refund_rejected', row.aggregate_id, reason, JSON.stringify({ outbox_id: row.id, kind: row.kind })])
  console.error(JSON.stringify({ event: 'commercial_refund_rejected', outbox_id: row.id, kind: row.kind, error: reason.slice(0, 200) }))
}

/** The human explanation of the credit notes the worker writes for a provider refund after fulfillment. */
const PROVIDER_REFUND_REASON = 'payment refunded after fulfillment — manual review'

/** Writes one pending system credit note on an invoice. */
async function insertSystemCreditNote(client: PoolClient, invoice: { id: string; customer_id: string }, cause: CreditNoteCause, reason: string, amount: { minor: number | string; currency: string; exponent: number }) {
  await client.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by,origin,cause) VALUES($1,$2,$3,'credit_note',$4,$5,$6,$7,'pending','system','system',$8)`,
    [randomUUID(), invoice.id, invoice.customer_id, reason, amount.minor, amount.currency, amount.exponent, cause])
}

/** A second successful charge for an order that was already paid: one pending credit note for that attempt, unless it has one. */
async function creditDuplicatePayment(client: PoolClient, attemptId: unknown): Promise<string | null> {
  const attempt = await lockAttempt(client, attemptId)
  if (typeof attempt === 'string') return attempt
  const reason = `${DUPLICATE_PAYMENT_REASON} (attempt ${attempt.id})`
  // The attempt id in the reason keys the note to its charge; only a system `duplicate_payment` note is searched, so no operator text can match.
  const existing = await client.query("SELECT id FROM invoice_adjustments WHERE invoice_id=$1 AND cause='duplicate_payment' AND reason=$2", [attempt.invoice_id, reason])
  if (!existing.rowCount) await insertSystemCreditNote(client, attempt.invoice, 'duplicate_payment', reason, { minor: attempt.amount_minor, currency: attempt.currency, exponent: attempt.exponent })
  return null
}

/** The attempt and its locked invoice, or the reason the row is malformed. */
async function lockAttempt(client: PoolClient, attemptId: unknown) {
  if (typeof attemptId !== 'string' || !z.uuid().safeParse(attemptId).success) return 'attempt_id_missing'
  const attempt = (await client.query('SELECT * FROM payment_attempts WHERE id=$1', [attemptId])).rows[0]
  if (!attempt) return 'payment_attempt_missing'
  const invoice = (await client.query('SELECT id,customer_id FROM invoices WHERE id=$1 FOR UPDATE', [attempt.invoice_id])).rows[0]
  return { ...attempt, invoice } as Record<string, any> & { invoice: { id: string; customer_id: string } }
}

/**
 * The provider refunded a payment after the order was fulfilled: the money is gone but the subscription stays applied.
 * The event carries the provider's cumulative refunded figure, and the note is only the part not credited yet, so a
 * replay credits nothing and each further partial refund credits its own part. A figure above what the attempt paid, or
 * in another currency, is rejected for the operator instead of crediting money that was never taken. The pending note
 * puts the invoice in the vendor's `credit_pending` list; the operator records the provider's refund reference on it.
 */
async function creditRefundedAfterFulfillment(client: PoolClient, payload: any): Promise<string | null> {
  const attempt = await lockAttempt(client, payload?.attempt_id)
  if (typeof attempt === 'string') return attempt
  const refunded = payload.refunded
  if (!refunded || !Number.isSafeInteger(refunded.minor) || refunded.minor <= 0) return 'refund_amount_missing'
  if (refunded.currency !== attempt.currency || refunded.exponent !== attempt.exponent) return 'refund_currency_mismatch'
  if (refunded.minor > Number(attempt.amount_minor)) return 'refund_exceeds_payment'
  const reason = `${PROVIDER_REFUND_REASON} (attempt ${attempt.id})`
  // Every credit note of the invoice counts, the vendor's own included: when the operator refunded this money through
  // `requestInvoiceRefund` first, the provider's event is that same money and adds nothing. Only a note for a duplicate
  // charge is other money (a different attempt's payment).
  const credited = Number((await client.query(`SELECT ${creditedMinorSql('$1')} AS total`, [attempt.invoice_id])).rows[0].total)
  const part = refunded.minor - credited
  if (part > 0) {
    await insertSystemCreditNote(client, attempt.invoice, 'provider_refund', reason, { minor: part, currency: attempt.currency, exponent: attempt.exponent })
    await client.query("UPDATE invoices SET status='credit_pending' WHERE id=$1 AND status='paid'", [attempt.invoice_id])
  }
  return null
}

/** Caller owns the transaction. Paid invoices and their lines are never erased. */
export async function recordFulfillmentFailure(client: PoolClient, { order_id, reason, actor }: {
  order_id: string; reason: string; actor: CommercialActor | string
}) {
  if (reason.trim().length < 3) throw new Error('reason_required')
  const invoices = await client.query("SELECT * FROM invoices WHERE order_id=$1 AND status IN ('paid','credit_pending') FOR UPDATE", [order_id])
  const ids: string[] = []
  for (const invoice of invoices.rows) {
    const credited = Number((await client.query(`SELECT ${creditedMinorSql('$1')} AS amount`, [invoice.id])).rows[0].amount)
    const remaining = Number(invoice.total_minor) - credited
    if (remaining <= 0) continue
    const id = randomUUID()
    await client.query("UPDATE invoices SET status='credit_pending' WHERE id=$1 AND status='paid'", [invoice.id])
    await client.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by,origin,cause)
      VALUES($1,$2,$3,'credit_note',$4,$5,$6,$7,'pending',$8,'system','fulfillment_failure')`,
    [id,invoice.id,invoice.customer_id,reason,remaining,invoice.currency,invoice.exponent,
      typeof actor === 'string' ? actor : actorLabel(actor)])
    ids.push(id)
  }
  if (ids.length && typeof actor !== 'string') await audit(client, actor, 'invoice.credit_pending', order_id, reason, { adjustment_ids: ids })
  return ids
}

/**
 * Records that the operator refunded a pending credit note through the provider's dashboard; no money moves here.
 * The note must be a pending credit note. Repeating the call with the same reference returns the recorded note
 * unchanged (a retry after a lost response), while a different reference on a closed note is refused.
 */
export async function refundCreditNote(pool: Pool, { adjustment_id, actor, request }: { adjustment_id: string; actor: CommercialActor; request: RefundCreditNoteRequest }) {
  try { return await recordRefund(pool, { adjustment_id, actor, request }) }
  catch (error) {
    // One provider refund closes one credit note: a reference already recorded on another note is refused.
    if ((error as { code?: string; constraint?: string }).constraint === 'invoice_adjustments_refund_reference') throw new CommercialHttpError('refund_reference_in_use', 409)
    throw error
  }
}
async function recordRefund(pool: Pool, { adjustment_id, actor, request }: { adjustment_id: string; actor: CommercialActor; request: RefundCreditNoteRequest }) {
  return transaction(pool, client => recordRefundIn(client, { adjustment_id, actor, refundedBy: actorLabel(actor), request, automatic: false }))
}

/**
 * The one recording of a refund on a credit note, for the operator's form (`automatic` false) and for the worker that
 * refunded through the provider (`automatic` true, `actor` the operator who requested it, `refundedBy` the system).
 * The form is refused while the worker still owns the refund (`refund_in_progress`), so the money is returned once.
 */
async function recordRefundIn(client: PoolClient, { adjustment_id, actor, refundedBy, request, automatic }: {
  adjustment_id: string; actor: CommercialActor; refundedBy: string; request: RefundCreditNoteRequest; automatic: boolean
}) {
  const note = (await client.query('SELECT * FROM invoice_adjustments WHERE id=$1 FOR UPDATE', [adjustment_id])).rows[0]
  if (!note) throw new CommercialHttpError('not_found', 404)
  if (note.kind === 'credit_note' && note.status === 'refunded' && note.refund_reference === request.external_reference) return adjustmentView(note)
  if (note.kind !== 'credit_note' || note.status !== 'pending') throw new CommercialHttpError('credit_note_not_pending', 409)
  if (!automatic && (await client.query("SELECT 1 FROM commercial_outbox WHERE kind='reconcile.refund' AND status='pending' AND payload->>'adjustment_id'=$1", [note.id])).rowCount)
    throw new CommercialHttpError('refund_in_progress', 409)
  // A note that may drop the subscription to the free base takes the subscription lock before the invoice, the order the
  // renewal, fulfilment and lock writers use (subscription, then its orders and invoices), so the two cannot deadlock.
  if (REFUND_LOCK_CAUSES.includes(note.cause)) await client.query(`SELECT 1 FROM subscriptions WHERE id=(SELECT subscription_id FROM invoices WHERE id=$1)
    FOR UPDATE`, [note.invoice_id])
  // A refund must return the whole invoice, and an invoice is refunded at most once. Checked before any write.
  const invoice = (await client.query('SELECT subscription_id,total_minor,currency,exponent FROM invoices WHERE id=$1 FOR SHARE', [note.invoice_id])).rows[0]
  if (!invoice) throw new CommercialHttpError('not_found', 404)
  // A customer-requested refund returns the whole invoice; a system note carries what the provider refunded or charged twice, which may be a part.
  const wrongAmount = note.origin === 'vendor' ? Number(note.amount_minor) !== Number(invoice.total_minor) : Number(note.amount_minor) > Number(invoice.total_minor)
  if (wrongAmount || note.currency !== invoice.currency) throw new CommercialHttpError('refund_not_full', 409)
  // A4: the customer-requested refund is once per invoice; a system note is keyed by its own charge, so each of those
  // may be refunded once without blocking another. Scoping the rule to the vendor origin is what keeps a second
  // duplicate from being stranded. The unique index says the same thing; this is the readable refusal.
  if (note.origin === 'vendor') {
    const already = await client.query("SELECT 1 FROM invoice_adjustments WHERE invoice_id=$1 AND status='refunded' AND origin='vendor' AND id<>$2", [note.invoice_id, note.id])
    if (already.rowCount) throw new CommercialHttpError('invoice_already_refunded', 409)
  }
  // The release-1 window (owner decision 2026-11-06) is judged ONCE, when `requestInvoiceRefund` creates the vendor
  // note. Recording the provider reference happens later, after the operator has refunded at the provider, so judging
  // the window again here would strand a note the customer was entitled to. A system note (a duplicate charge, a
  // payment after cancellation, a failed fulfilment) never had a window.
  const updated = (await client.query("UPDATE invoice_adjustments SET status='refunded',refund_reference=$2,refunded_by=$3,refunded_at=now() WHERE id=$1 RETURNING *",
    [note.id, request.external_reference, refundedBy])).rows[0]
  if (updated.cause === 'fulfillment_failure' || updated.cause === 'payment_after_cancellation') await settleUndeliveredOrder(client, note.invoice_id)
  await audit(client, actor, 'invoice.credit_refunded', note.id, request.reason,
    { invoice_id: note.invoice_id, external_reference: request.external_reference, amount_minor: Number(note.amount_minor), currency: note.currency, ...(automatic ? { executed_by: refundedBy, automatic: true } : {}) })
  // Owner decision 2026-11-13: the refunded first payment bought nothing, so the subscription drops to the free base now.
  if (REFUND_LOCK_CAUSES.includes(updated.cause) && (await refundLockedInvoices(client, [note.invoice_id], ['refunded'])).has(note.invoice_id)) {
    await armRefundLock(client, { subscription_id: invoice.subscription_id, now: new Date() })
    await audit(client, actor, 'subscription.refund_lock_armed', invoice.subscription_id, request.reason,
      { invoice_id: note.invoice_id, adjustment_id: note.id })
  }
  return adjustmentView(updated)
}

/** The credit notes that return the customer's own payment: the vendor's 14-day refund and the provider's refund of it. */
const REFUND_LOCK_CAUSES: string[] = ['vendor_refund', 'provider_refund'] satisfies CreditNoteCause[]

/**
 * The invoices whose refund drops their subscription to the free base, in one definition for the trigger in
 * `recordRefund` (counting only refunded notes) and the vendor console's warning before recording one (counting the
 * pending notes as recorded). All must hold: the customer-refund notes cover the whole invoice; it bought something other
 * than an AI top-up or tax; its order was delivered and not cancelled; it is the customer's first payment (the window
 * is never judged again here); the subscription is past its trial (`active`, `past_due` or `suspended`); and no other
 * initial or renewal invoice of the subscription is paid and unrefunded, since that payment bought the configuration for
 * its period. A partial provider refund, or the refund of a later payment, stays with the vendor's manual review.
 */
export async function refundLockedInvoices(client: Pick<Pool, 'query'>, invoiceIds: string[], counted: ('refunded' | 'pending')[]): Promise<Set<string>> {
  if (!invoiceIds.length) return new Set()
  const rows = (await client.query(`SELECT i.id FROM invoices i JOIN orders o ON o.id=i.order_id JOIN subscriptions s ON s.id=i.subscription_id
    WHERE i.id=ANY($1::uuid[]) AND o.fulfillment_state='applied' AND NOT o.cancelled AND s.state IN ('active','past_due','suspended')
      AND EXISTS (SELECT 1 FROM invoice_lines l WHERE l.invoice_id=i.id AND l.kind NOT IN ('ai_topup','tax') AND l.amount_minor>0)
      AND NOT EXISTS (SELECT 1 FROM invoices paid WHERE paid.subscription_id=i.subscription_id AND paid.id<>i.id
        AND paid.kind IN ('initial','renewal') AND paid.status IN ('paid','credit_pending') AND paid.total_minor>${creditedMinorSql('paid.id')})
      AND (SELECT COALESCE(sum(ia.amount_minor),0) FROM invoice_adjustments ia WHERE ia.invoice_id=i.id AND ia.kind='credit_note'
        AND ia.cause=ANY($2::text[]) AND ia.status=ANY($3::text[])) >= i.total_minor`, [invoiceIds, REFUND_LOCK_CAUSES, counted])).rows
  if (!rows.length) return new Set()
  const eligibility = await refundEligibilityForInvoices(client, rows.map(row => row.id as string))
  return new Set(rows.map(row => row.id as string).filter(id => eligibility.get(id)?.first_payment))
}

/**
 * A fulfilment-failure or payment-after-cancellation note refunded by hand (a bank transfer, or an automatic refund the
 * provider could not do) finishes the order left in refund_pending, and closes its automatic outbox row if it is still
 * pending, once the invoice is credited in full.
 */
async function settleUndeliveredOrder(client: PoolClient, invoiceId: string) {
  const settled = (await client.query(`UPDATE orders o SET payment_state='refunded' FROM invoices i
    WHERE i.id=$1 AND o.id=i.order_id AND o.payment_state='refund_pending' AND ${creditedMinorSql('i.id')}>=i.total_minor RETURNING o.id`, [invoiceId])).rows[0]
  if (settled) await client.query("UPDATE commercial_outbox SET status='done',processed_at=now() WHERE kind='reconcile.refund' AND aggregate_id=$1 AND dedupe_key='fulfillment-undelivered' AND status='pending'", [settled.id])
}

/**
 * The one refund-window rule. The owner's meaning: a payment on Riyadh day D is refundable through the END of day D+days,
 * and closed from the day after. Whole calendar days, not 24-hour blocks, so a payment made late on its own day still
 * gets the full window. A window of 0 days means the vendor offers none.
 */
export function refundWindow(succeededAt: Date, days: number, now = new Date()): { open: boolean; until: string } {
  const paidOn = riyadhDate(succeededAt)
  const until = new Date(Date.parse(`${paidOn}T12:00:00+03:00`) + days * 86_400_000).toISOString().slice(0, 10)
  return { open: days > 0 && daysBetween(paidOn, riyadhDate(now)) <= days, until: `${until}T23:59:59+03:00` }
}

export type Refundability = { refundable: boolean; first_payment: boolean; until: string | null; window_days: number }

/**
 * A2: the vendor's entry point for the 14-day rule. A customer who asks for their money back inside the window has no
 * pending credit note yet — the three system inserts only record duplicates, cancellation and failed fulfilment — so
 * this creates the vendor-origin note the record-refund flow then closes, and it is the only place such a note is made.
 *
 * The note is the full invoice total, because a refund is all-or-nothing (recordRefund refuses a partial one). This is
 * the only place the eligibility rules (first payment, inside the window) are judged: `recordRefund` keeps only the
 * structural checks. A note that already exists for this invoice answers `refund_already_requested` rather than making
 * a second one, which the unique index would refuse anyway.
 */
export async function requestInvoiceRefund(pool: Pool, { invoice_id, actor, reason, units_used }: { invoice_id: string; actor: CommercialActor; reason: string; units_used?: number }) {
  return transaction(pool, async client => {
    // The invoice row is locked first: two operators asking together make one note, and the lock order matches the
    // settlement path (invoice, then note) so neither can deadlock with a concurrent refund.
    const invoice = (await client.query('SELECT * FROM invoices WHERE id=$1 FOR UPDATE', [invoice_id])).rows[0]
    if (!invoice) throw new CommercialHttpError('not_found', 404)
    // The provider may have refunded this money first: its note is the obligation, so the operator attaches to it (and
    // records the provider's reference on it) instead of opening a second one for the same refund.
    const providerNotes = (await client.query(`SELECT * FROM invoice_adjustments WHERE invoice_id=$1 AND kind='credit_note' AND cause='provider_refund'
      AND status<>'void' ORDER BY created_at,id`, [invoice_id])).rows
    if (providerNotes.length) {
      const open = providerNotes.find(note => note.status === 'pending')
      if (!open) throw new CommercialHttpError('refund_already_requested', 409)
      return adjustmentView(open)
    }
    if (invoice.status !== 'paid') throw new CommercialHttpError('invoice_not_paid', 409)
    const already = await client.query("SELECT 1 FROM invoice_adjustments WHERE invoice_id=$1 AND origin='vendor' AND kind='credit_note' AND status<>'void'", [invoice_id])
    if (already.rowCount) throw new CommercialHttpError('refund_already_requested', 409)
    await assertRefundable(client, invoice.customer_id, invoice.id)
    // A paid order still being delivered cannot be refunded yet: recording the refund drops the subscription to the free
    // base, which needs the delivery to have ended first. A failed delivery has its own credit note.
    if (invoice.order_id) {
      const delivering = await client.query(`SELECT 1 FROM orders WHERE id=$1 AND payment_state='paid' AND NOT cancelled
        AND fulfillment_state IN ('not_started','queued','applying','needs_intervention')`, [invoice.order_id])
      if (delivering.rowCount) throw new CommercialHttpError('fulfillment_pending', 409)
    }
    // An AI top-up on this invoice must be unspent: the same rule the top-up refund route applies.
    if (invoice.order_id) await assertTopupUnused(client, invoice.order_id, units_used)
    // The note's `created_at` is the request time the window was judged at; recording the refund later never re-judges it.
    const id = randomUUID()
    const row = (await client.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by,origin,cause)
      VALUES($1,$2,$3,'credit_note',$4,$5,$6,$7,'pending',$8,'vendor','vendor_refund') RETURNING *`,
    [id, invoice.id, invoice.customer_id, reason, invoice.total_minor, invoice.currency, invoice.exponent, actorLabel(actor)])).rows[0]
    await audit(client, actor, 'invoice.refund_requested', invoice.id, reason, { adjustment_id: id, amount_minor: Number(invoice.total_minor), currency: invoice.currency })
    // The whole invoice goes back, so an AI top-up it paid for stops counting (and the tenant is told).
    if (invoice.order_id) await markTopupRefunded(client, invoice.order_id, actorLabel(actor), reason)
    // A card payment is returned through the provider by the refund worker, once; a bank transfer has nothing to refund there
    // and stays with the operator's form.
    const paying = await payingAttempt(client, invoice.id)
    if (paying && paying.provider !== BANK_TRANSFER_PROVIDER) await enqueueOutbox(client, { kind: 'reconcile.refund', aggregate_id: invoice.order_id as string,
      dedupe_key: `vendor-refund:${id}`, payload: { attempt_id: paying.id, adjustment_id: id, automatic: true, requested_by: actor } satisfies RefundOutboxPayload })
    return adjustmentView(row)
  })
}

/** The attempt that paid this invoice, if it was paid. `succeeded_at` is immutable, `updated_at` is not. */
async function payingAttempt(client: Pick<Pool, 'query'>, invoiceId: string) {
  // `orders.paid_attempt_id` is the one attempt that bought the order; a duplicate transfer is succeeded money that
  // bought nothing. Reading any succeeded attempt here would let a duplicate stand in for the payment. NULLS LAST and
  // `succeeded_at IS NOT NULL` keep a row without a success time from ever reading as 1970.
  return (await client.query(`SELECT a.id,a.provider,a.succeeded_at FROM payment_attempts a JOIN orders o ON o.id=a.order_id
    WHERE a.invoice_id=$1 AND a.status='succeeded' AND a.succeeded_at IS NOT NULL AND o.paid_attempt_id=a.id
    ORDER BY a.succeeded_at,a.id LIMIT 1`, [invoiceId])).rows[0]
}

/**
 * Whether refunding one invoice is allowed: its payment must be the customer's first, and that first payment must
 * still be inside the window. A renewal, a later invoice or a second payment is never refundable.
 */
export async function refundEligibility(client: Pick<Pool, 'query'>, customerId: string, invoiceId: string): Promise<Refundability> {
  const { refund_window_days: days } = await billingSettings(client)
  const paying = await payingAttempt(client, invoiceId)
  if (!paying) return { refundable: false, first_payment: false, until: null, window_days: days }
  // "First" is the payment that succeeded earliest, by its immutable success time; the id breaks a tie so there is
  // always exactly one first. Only an attempt that actually paid an order counts: a duplicate transfer, or a second
  // provider charge on an already-paid order, is succeeded money that bought nothing, so it must never displace the
  // payment the customer made. Without this a duplicate carrying an earlier value date would become "the first payment"
  // and the real one would stop being refundable.
  const first = (await client.query(`SELECT a.id FROM payment_attempts a JOIN orders o ON o.id=a.order_id
    WHERE o.customer_id=$1 AND a.status='succeeded' AND o.paid_attempt_id=a.id
    ORDER BY a.succeeded_at NULLS LAST,a.id LIMIT 1`, [customerId])).rows[0]
  if (!first || first.id !== paying.id) return { refundable: false, first_payment: false, until: null, window_days: days }
  if (!paying.succeeded_at) return { refundable: false, first_payment: false, until: null, window_days: days }
  const window = refundWindow(new Date(paying.succeeded_at), days)
  return { refundable: window.open, first_payment: true, until: window.until, window_days: days }
}

/**
 * The same eligibility for a whole page of invoices in one round trip (the vendor list shows 50 at a time; three
 * queries per invoice would be 150). One query gives each invoice's paying attempt and whether it was the customer's
 * first for that customer, and the window is computed here from the same rule below.
 *
 * B: both queries are scoped — the paying attempts to the invoices asked for, the "first payment" lookup to those
 * invoices' customers. Partitioning by invoice (not by order) matters: one order may carry several invoices, and a
 * renewal could share one, so an order-based row_number would pick the wrong row as the invoice's payment.
 */
export async function refundEligibilityForInvoices(client: Pick<Pool, 'query'>, invoiceIds: string[]): Promise<Map<string, Refundability>> {
  const out = new Map<string, Refundability>()
  if (!invoiceIds.length) return out
  const { refund_window_days: days } = await billingSettings(client)
  const rows = (await client.query(`
    WITH paid AS (
      SELECT i.id AS invoice_id, i.customer_id, a.succeeded_at, a.id AS attempt_id,
             row_number() OVER (PARTITION BY i.id ORDER BY a.succeeded_at, a.id) AS rn
      FROM invoices i JOIN payment_attempts a ON a.invoice_id = i.id AND a.status = 'succeeded'
      JOIN orders o ON o.id = a.order_id AND o.paid_attempt_id = a.id
      WHERE i.id = ANY($1::uuid[])
    ), asked AS (
      SELECT DISTINCT customer_id FROM paid
    ), firsts AS (
      SELECT DISTINCT ON (o.customer_id) o.customer_id, a.id AS attempt_id
      FROM payment_attempts a JOIN orders o ON o.id = a.order_id
      WHERE a.status = 'succeeded' AND o.paid_attempt_id = a.id AND o.customer_id IN (SELECT customer_id FROM asked)
      ORDER BY o.customer_id, a.succeeded_at, a.id
    )
    SELECT p.invoice_id, p.customer_id, p.succeeded_at, (f.attempt_id = p.attempt_id) AS is_first
    FROM paid p LEFT JOIN firsts f ON f.customer_id = p.customer_id
    WHERE p.rn = 1`, [invoiceIds])).rows
  const now = new Date()
  for (const row of rows) {
    if (!row.succeeded_at) continue // never a 1970 window
    const window = refundWindow(new Date(row.succeeded_at), days, now)
    out.set(row.invoice_id as string, {
      refundable: Boolean(row.is_first) && window.open,
      first_payment: Boolean(row.is_first), until: window.until, window_days: days,
    })
  }
  return out
}

/** Two refusals, because the vendor needs to know which rule stopped them. */
async function assertRefundable(client: Pick<Pool, 'query'>, customerId: string, invoiceId: string) {
  const eligibility = await refundEligibility(client, customerId, invoiceId)
  if (!eligibility.first_payment) throw new CommercialHttpError('refund_not_first_payment', 409)
  if (!eligibility.refundable) throw new CommercialHttpError('refund_window_closed', 409)
}
