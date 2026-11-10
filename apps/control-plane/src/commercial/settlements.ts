import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { z } from 'zod'
import { transaction } from '../db.js'
import { daysBetween, riyadhDate, type RefundCreditNoteRequest } from '@liwan/commercial-contracts'
import { audit, CommercialHttpError, type CommercialActor } from './lifecycle.js'
import { adjustmentView } from './invoices.js'
import type { PaymentAdapter } from './payment-adapter.js'
import { actorLabel } from '../admin-auth/grants.js'
import { billingSettings } from './billing-settings.js'
import { claimOutbox, completeOutbox, deferOutbox } from './outbox.js'
import { creditedMinorSql, DUPLICATE_PAYMENT_REASON } from './refund-credit.js'
import { markTopupRefunded } from './ai-ledger.js'

/** Refunds the provider cannot do for this payment: retrying changes nothing, so the row goes to the operator at once. */
const NON_RETRYABLE_REFUND = ['provider_refund_unavailable', 'provider_refund_payment_mismatch']
/** Tries of one automatic provider refund (1, 2, 4, 8, 16 minute backoff between them) before the operator takes over. */
const AUTOMATIC_REFUND_ATTEMPTS = 6
const MANUAL_REVIEW_REASON = 'payment after cancellation — manual review'

export async function processRefundOutbox(pool: Pool, adapter?: PaymentAdapter): Promise<number> {
  let automatic = 0
  for (const row of await claimOutbox(pool, ['reconcile.refund'], 20, { automatic: true })) {
    try {
      if (!adapter) await handOffAutomaticRefund(pool, row, 'provider_refund_unavailable')
      else await refundUndelivered(pool, adapter, row)
      automatic++
    } catch (error) {
      const code = error instanceof Error ? error.message : 'provider_refund_failed'
      try {
        if (NON_RETRYABLE_REFUND.includes(code) || row.attempts + 1 >= AUTOMATIC_REFUND_ATTEMPTS) {
          await handOffAutomaticRefund(pool, row, code)
          automatic++
        } else await deferOutbox(pool, row.id, code)
      } catch (handOffError) {
        console.error(`[settlements] automatic refund ${row.id} could not be handed to the operator`, handOffError)
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
          const existing = await client.query('SELECT id FROM invoice_adjustments WHERE invoice_id=$1 AND reason=$2', [invoice.id,reason])
          if (!existing.rowCount) await client.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by,origin)
            VALUES($1,$2,$3,'credit_note',$4,$5,$6,$7,'pending','system','system')`,
          [randomUUID(),invoice.id,invoice.customer_id,reason,invoice.total_minor,invoice.currency,invoice.exponent])
        }
      }
      if (rejected) await rejectOutboxRow(client, row, rejected)
      else await client.query("UPDATE commercial_outbox SET status='done',processed_at=now() WHERE id=$1", [row.id])
    }
    return rows.length
  })
}

const AUTOMATIC_CREDIT = 'Payment returned after an undelivered trial order'

/**
 * An automatic refund that cannot finish (no adapter, a payment the provider cannot refund, retries used up) becomes the
 * manual review the operator already works: one pending credit note for what the attempt paid and is not yet credited
 * (an undelivered order already has its fulfilment note, so it gets none more), and the row closed as failed with its
 * reason. The row keeps its payload, which trial recovery reads as proof. Recording the refund on the note settles the order.
 */
async function handOffAutomaticRefund(pool: Pool, row: { id: string; kind: string; aggregate_id: string; payload: unknown }, reason: string) {
  await transaction(pool, async client => {
    const pending = (await client.query("SELECT 1 FROM commercial_outbox WHERE id=$1 AND status='pending' FOR UPDATE", [row.id])).rowCount
    if (!pending) return
    const attemptId = (row.payload as { attempt_id?: string }).attempt_id
    const attempt = typeof attemptId === 'string' && z.uuid().safeParse(attemptId).success ? (await client.query(`SELECT a.* FROM payment_attempts a
      JOIN orders o ON o.id=a.order_id WHERE a.id=$1 AND o.id::text=$2 AND o.payment_state='refund_pending' AND o.paid_attempt_id=a.id`, [attemptId, row.aggregate_id])).rows[0] : undefined
    if (attempt) {
      const invoice = (await client.query('SELECT id,customer_id FROM invoices WHERE id=$1 FOR UPDATE', [attempt.invoice_id])).rows[0]
      const credited = Number((await client.query(`SELECT ${creditedMinorSql('$1')} AS amount`, [invoice.id])).rows[0].amount)
      if (credited < Number(attempt.amount_minor))
        await insertSystemCreditNote(client, invoice, MANUAL_REVIEW_REASON, { minor: Number(attempt.amount_minor) - credited, currency: attempt.currency, exponent: attempt.exponent })
    }
    await rejectOutboxRow(client, { id: row.id, kind: row.kind, aggregate_id: row.aggregate_id }, reason)
  })
}

/** Confirm the original payment first. An interrupted refund is reconciled by cumulative provider amount. */
async function refundUndelivered(pool: Pool, adapter: PaymentAdapter, row: { id: string; aggregate_id: string; payload: unknown }) {
  const payload = row.payload as { attempt_id?: string; payment_id?: string }
  const lock = await pool.connect()
  let owned = false
  try {
    owned = (await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS held', [`commercial-refund:${row.aggregate_id}`])).rows[0].held
    if (!owned) return
    const attempt = (await lock.query(`SELECT a.*,o.payment_state,i.customer_id,i.total_minor
      FROM payment_attempts a JOIN orders o ON o.id=a.order_id JOIN invoices i ON i.id=a.invoice_id
      WHERE a.id=$1 AND a.order_id::text=$2 AND o.paid_attempt_id=a.id AND o.fulfillment_state<>'applied'`,
    [payload.attempt_id ?? null, row.aggregate_id])).rows[0]
    if (!attempt || !['refund_pending','refunded'].includes(attempt.payment_state)) throw Error('refund_attempt_unavailable')
    if (attempt.provider !== adapter.provider || attempt.mode !== adapter.mode || !attempt.provider_ref) throw Error('provider_refund_unavailable')
    const read = () => attempt.token_charge ? adapter.lookupPayment?.(attempt.provider_ref) : adapter.lookupAttempt(attempt.provider_ref)
    const payment = await read()
    const total = Number(attempt.amount_minor)
    if (!payment?.payment_id || !['succeeded','refunded'].includes(payment.status)
      || payment.amount.minor !== total || payment.amount.currency !== attempt.currency || payment.amount.exponent !== attempt.exponent
      || payment.merchant_account !== adapter.merchantAccount || payment.live !== (adapter.mode === 'live')
      || (payload.payment_id && payload.payment_id !== payment.payment_id)) throw Error('provider_refund_payment_mismatch')
    const returned = payment.refunded?.minor ?? (payment.status === 'refunded' ? null : 0)
    if (returned === null || returned < 0 || returned > total) throw Error('provider_refund_amount_unverified')
    if (returned < total) {
      const result = await adapter.refund(payment.payment_id, { minor: total - returned, currency: attempt.currency, exponent: attempt.exponent })
      const confirmed = await read()
      if (result.payment_id !== payment.payment_id || confirmed?.payment_id !== payment.payment_id || confirmed.refunded?.minor !== total
        || confirmed.refunded.currency !== attempt.currency || confirmed.refunded.exponent !== attempt.exponent)
        throw Error('provider_refund_unverified')
    }
    await transaction(pool, async client => {
      const invoice = (await client.query('SELECT * FROM invoices WHERE id=$1 FOR UPDATE', [attempt.invoice_id])).rows[0]
      const note = (await client.query(`SELECT id FROM invoice_adjustments WHERE invoice_id=$1 AND kind='credit_note'
        AND status='pending' AND origin='system' AND created_by='commercial-fulfillment' ORDER BY created_at DESC,id LIMIT 1 FOR UPDATE`, [invoice.id])).rows[0]
      // The customer's own pending refund request for the whole invoice is this same money: close it instead of leaving it to be paid twice.
      const vendorNote = note ? undefined : (await client.query(`SELECT id FROM invoice_adjustments WHERE invoice_id=$1 AND kind='credit_note'
        AND status='pending' AND origin='vendor' AND amount_minor=$2 ORDER BY created_at,id LIMIT 1 FOR UPDATE`, [invoice.id, invoice.total_minor])).rows[0]
      if (note || vendorNote) {
        await client.query(`UPDATE invoice_adjustments SET status='refunded',refund_reference=$2,refunded_by='system',refunded_at=now()
          WHERE id=$1`, [(note ?? vendorNote).id, payment.payment_id])
      } else {
        const credited = Number((await client.query(`SELECT ${creditedMinorSql('$1')} AS amount`, [invoice.id])).rows[0].amount)
        if (credited < total) await client.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,
          status,created_by,origin,refund_reference,refunded_at,refunded_by)
          VALUES($1,$2,$3,'credit_note',$4,$5,$6,$7,'refunded','system','system',$8,now(),'system')`,
        [randomUUID(), invoice.id, invoice.customer_id, AUTOMATIC_CREDIT, total - credited, attempt.currency, attempt.exponent, payment.payment_id])
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

/**
 * A row that cannot become a credit note (a missing attempt, a refund above what was paid) is closed as failed with its
 * reason on the row, in the audit trail the operator reads and in the log, and the rest of the batch goes on: one bad row
 * must never stall every refund behind it.
 */
async function rejectOutboxRow(client: PoolClient, row: { id: string; kind: string; aggregate_id: string }, reason: string) {
  await client.query("UPDATE commercial_outbox SET status='failed',processed_at=now(),payload=payload || jsonb_build_object('error',$2::text) WHERE id=$1", [row.id, reason])
  await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(), 'system', 'payment.refund_rejected', row.aggregate_id, reason, JSON.stringify({ outbox_id: row.id, kind: row.kind })])
  console.error(`[settlements] refund outbox row ${row.id} (${row.kind}) rejected: ${reason}`)
}

/** The reason prefix of the credit notes the worker writes for a provider refund after fulfillment. */
export const PROVIDER_REFUND_REASON = 'payment refunded after fulfillment — manual review'

/** Writes one pending system credit note on an invoice. */
async function insertSystemCreditNote(client: PoolClient, invoice: { id: string; customer_id: string }, reason: string, amount: { minor: number | string; currency: string; exponent: number }) {
  await client.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by,origin) VALUES($1,$2,$3,'credit_note',$4,$5,$6,$7,'pending','system','system')`,
    [randomUUID(), invoice.id, invoice.customer_id, reason, amount.minor, amount.currency, amount.exponent])
}

/** A second successful charge for an order that was already paid: one pending credit note for that attempt, unless it has one. */
async function creditDuplicatePayment(client: PoolClient, attemptId: unknown): Promise<string | null> {
  const attempt = await lockAttempt(client, attemptId)
  if (typeof attempt === 'string') return attempt
  const reason = `${DUPLICATE_PAYMENT_REASON} (attempt ${attempt.id})`
  const existing = await client.query('SELECT id FROM invoice_adjustments WHERE invoice_id=$1 AND reason=$2', [attempt.invoice_id, reason])
  if (!existing.rowCount) await insertSystemCreditNote(client, attempt.invoice, reason, { minor: attempt.amount_minor, currency: attempt.currency, exponent: attempt.exponent })
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
    await insertSystemCreditNote(client, attempt.invoice, reason, { minor: part, currency: attempt.currency, exponent: attempt.exponent })
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
    await client.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by,origin)
      VALUES($1,$2,$3,'credit_note',$4,$5,$6,$7,'pending',$8,'system')`,
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
  return transaction(pool, async client => {
    const note = (await client.query('SELECT * FROM invoice_adjustments WHERE id=$1 FOR UPDATE', [adjustment_id])).rows[0]
    if (!note) throw new CommercialHttpError('not_found', 404)
    if (note.kind === 'credit_note' && note.status === 'refunded' && note.refund_reference === request.external_reference) return adjustmentView(note)
    if (note.kind !== 'credit_note' || note.status !== 'pending') throw new CommercialHttpError('credit_note_not_pending', 409)
    // A refund must return the whole invoice, and an invoice is refunded at most once. Checked before any write.
    const invoice = (await client.query('SELECT total_minor,currency,exponent FROM invoices WHERE id=$1 FOR SHARE', [note.invoice_id])).rows[0]
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
      [note.id, request.external_reference, actorLabel(actor)])).rows[0]
    if (updated.origin === 'system' && (updated.created_by === 'commercial-fulfillment' || updated.reason === MANUAL_REVIEW_REASON)) await settleUndeliveredOrder(client, note.invoice_id)
    await audit(client, actor, 'invoice.credit_refunded', note.id, request.reason,
      { invoice_id: note.invoice_id, external_reference: request.external_reference, amount_minor: Number(note.amount_minor), currency: note.currency })
    return adjustmentView(updated)
  })
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
export async function requestInvoiceRefund(pool: Pool, { invoice_id, actor, reason }: { invoice_id: string; actor: CommercialActor; reason: string }) {
  return transaction(pool, async client => {
    // The invoice row is locked first: two operators asking together make one note, and the lock order matches the
    // settlement path (invoice, then note) so neither can deadlock with a concurrent refund.
    const invoice = (await client.query('SELECT * FROM invoices WHERE id=$1 FOR UPDATE', [invoice_id])).rows[0]
    if (!invoice) throw new CommercialHttpError('not_found', 404)
    // The provider may have refunded this money first: its note is the obligation, so the operator attaches to it (and
    // records the provider's reference on it) instead of opening a second one for the same refund.
    const providerNotes = (await client.query(`SELECT * FROM invoice_adjustments WHERE invoice_id=$1 AND kind='credit_note' AND origin='system'
      AND status<>'void' AND reason LIKE $2 ORDER BY created_at,id`, [invoice_id, `${PROVIDER_REFUND_REASON}%`])).rows
    if (providerNotes.length) {
      const open = providerNotes.find(note => note.status === 'pending')
      if (!open) throw new CommercialHttpError('refund_already_requested', 409)
      return adjustmentView(open)
    }
    if (invoice.status !== 'paid') throw new CommercialHttpError('invoice_not_paid', 409)
    const already = await client.query("SELECT 1 FROM invoice_adjustments WHERE invoice_id=$1 AND origin='vendor' AND kind='credit_note' AND status<>'void'", [invoice_id])
    if (already.rowCount) throw new CommercialHttpError('refund_already_requested', 409)
    await assertRefundable(client, invoice.customer_id, invoice.id)
    // The note's `created_at` is the request time the window was judged at; recording the refund later never re-judges it.
    const id = randomUUID()
    const row = (await client.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by,origin)
      VALUES($1,$2,$3,'credit_note',$4,$5,$6,$7,'pending',$8,'vendor') RETURNING *`,
    [id, invoice.id, invoice.customer_id, reason, invoice.total_minor, invoice.currency, invoice.exponent, actorLabel(actor)])).rows[0]
    await audit(client, actor, 'invoice.refund_requested', invoice.id, reason, { adjustment_id: id, amount_minor: Number(invoice.total_minor), currency: invoice.currency })
    // The whole invoice goes back, so an AI top-up it paid for stops counting (and the tenant is told).
    if (invoice.order_id) await markTopupRefunded(client, invoice.order_id, actorLabel(actor), reason)
    return adjustmentView(row)
  })
}

/** The attempt that paid this invoice, if it was paid. `succeeded_at` is immutable, `updated_at` is not. */
async function payingAttempt(client: Pick<Pool, 'query'>, invoiceId: string) {
  // `orders.paid_attempt_id` is the one attempt that bought the order; a duplicate transfer is succeeded money that
  // bought nothing. Reading any succeeded attempt here would let a duplicate stand in for the payment. NULLS LAST and
  // `succeeded_at IS NOT NULL` keep a row without a success time from ever reading as 1970.
  return (await client.query(`SELECT a.id,a.succeeded_at FROM payment_attempts a JOIN orders o ON o.id=a.order_id
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
