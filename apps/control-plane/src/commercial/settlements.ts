import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { transaction } from '../db.js'
import { daysBetween, riyadhDate, type RefundCreditNoteRequest } from '@liwan/commercial-contracts'
import { audit, CommercialHttpError, type CommercialActor } from './lifecycle.js'
import { adjustmentView } from './invoices.js'
import type { PaymentAdapter } from './payment-adapter.js'
import { actorLabel } from '../admin-auth/grants.js'
import { billingSettings } from './billing-settings.js'

/** Late payment is a manual credit review, never an automatic provider refund. */
export async function processRefundOutbox(pool: Pool, _adapter?: PaymentAdapter): Promise<number> {
  return transaction(pool, async client => {
    const rows = (await client.query("SELECT * FROM commercial_outbox WHERE kind='reconcile.refund' AND status='pending' ORDER BY created_at,id FOR UPDATE SKIP LOCKED")).rows
    const reason = 'payment after cancellation — manual review'
    for (const row of rows) {
      if (row.payload?.duplicate) { await creditDuplicatePayment(client, row.payload.attempt_id); await client.query("UPDATE commercial_outbox SET status='done',processed_at=now() WHERE id=$1", [row.id]); continue }
      // Lock invoices too: separate event ids can refer to the same invoice.
      const invoices = (await client.query('SELECT * FROM invoices WHERE order_id=$1 ORDER BY id FOR UPDATE', [row.aggregate_id])).rows
      for (const invoice of invoices) {
        const existing = await client.query('SELECT id FROM invoice_adjustments WHERE invoice_id=$1 AND reason=$2', [invoice.id,reason])
        if (!existing.rowCount) await client.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by)
          VALUES($1,$2,$3,'credit_note',$4,$5,$6,$7,'pending','system')`,
        [randomUUID(),invoice.id,invoice.customer_id,reason,invoice.total_minor,invoice.currency,invoice.exponent])
      }
      await client.query("UPDATE commercial_outbox SET status='done',processed_at=now() WHERE id=$1", [row.id])
    }
    return rows.length
  })
}

/** A second successful charge for an order that was already paid: one pending credit note for that attempt's amount. */
async function creditDuplicatePayment(client: PoolClient, attemptId: string) {
  const attempt = (await client.query('SELECT * FROM payment_attempts WHERE id=$1', [attemptId])).rows[0]
  if (!attempt) return
  const invoice = (await client.query('SELECT customer_id FROM invoices WHERE id=$1 FOR UPDATE', [attempt.invoice_id])).rows[0]
  const reason = `duplicate payment — manual review (attempt ${attempt.id})`
  const existing = await client.query('SELECT id FROM invoice_adjustments WHERE invoice_id=$1 AND reason=$2', [attempt.invoice_id, reason])
  if (!existing.rowCount) await client.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by)
    VALUES($1,$2,$3,'credit_note',$4,$5,$6,$7,'pending','system')`,
  [randomUUID(), attempt.invoice_id, invoice.customer_id, reason, attempt.amount_minor, attempt.currency, attempt.exponent])
}

/** Caller owns the transaction. Paid invoices and their lines are never erased. */
export async function recordFulfillmentFailure(client: PoolClient, { order_id, reason, actor }: {
  order_id: string; reason: string; actor: CommercialActor | string
}) {
  if (reason.trim().length < 3) throw new Error('reason_required')
  const invoices = await client.query("UPDATE invoices SET status='credit_pending' WHERE order_id=$1 AND status='paid' RETURNING *", [order_id])
  const ids: string[] = []
  for (const invoice of invoices.rows) {
    const id = randomUUID()
    await client.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by)
      VALUES($1,$2,$3,'credit_note',$4,$5,$6,$7,'pending',$8)`,
    [id,invoice.id,invoice.customer_id,reason,invoice.total_minor,invoice.currency,invoice.exponent,
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
    // Release 1 rule (owner decision 2026-11-06): only the customer's first successful payment is refundable, and only
    // inside the vendor's window. This is refused before any write, and the console never offers a way around it.
    await assertRefundable(client, note.customer_id, note.invoice_id)
    const updated = (await client.query("UPDATE invoice_adjustments SET status='refunded',refund_reference=$2,refunded_by=$3,refunded_at=now() WHERE id=$1 RETURNING *",
      [note.id, request.external_reference, actorLabel(actor)])).rows[0]
    await audit(client, actor, 'invoice.credit_refunded', note.id, request.reason,
      { invoice_id: note.invoice_id, external_reference: request.external_reference, amount_minor: Number(note.amount_minor), currency: note.currency })
    return adjustmentView(updated)
  })
}

export type Refundability = { refundable: boolean; first_payment: boolean; until: string | null; window_days: number }

/** The attempt that paid this invoice, if it was paid. */
async function payingAttempt(client: Pick<Pool, 'query'>, invoiceId: string) {
  return (await client.query(`SELECT a.id,a.updated_at FROM payment_attempts a WHERE a.invoice_id=$1 AND a.status='succeeded'
    ORDER BY a.updated_at,a.created_at,a.id LIMIT 1`, [invoiceId])).rows[0]
}

/**
 * Whether refunding one invoice is allowed: its payment must be the customer's first, and that first payment must
 * still be inside the window. A renewal, a later invoice or a second payment is never refundable.
 */
export async function refundEligibility(client: Pick<Pool, 'query'>, customerId: string, invoiceId: string): Promise<Refundability> {
  const { refund_window_days: days } = await billingSettings(client)
  const paying = await payingAttempt(client, invoiceId)
  if (!paying) return { refundable: false, first_payment: false, until: null, window_days: days }
  // "First" is the attempt that paid for this customer earliest. `created_at` is the transaction timestamp, which two
  // orders written close together share, so the attempt's own creation breaks the tie: one first, always.
  const first = (await client.query(`SELECT a.id,a.updated_at FROM payment_attempts a JOIN orders o ON o.id=a.order_id
    WHERE o.customer_id=$1 AND a.status='succeeded' ORDER BY a.updated_at,a.created_at,a.id LIMIT 1`, [customerId])).rows[0]
  if (!first || first.id !== paying.id) return { refundable: false, first_payment: false, until: null, window_days: days }
  // The window covers whole days, not 14 x 24 hours from the minute of payment: a payment on day 1 is refundable
  // through the end of day 14 and closed from day 15. Both ends are Riyadh calendar days. A window of 0 days means
  // the vendor offers no refund at all, so nothing is ever inside it.
  const paidOn = riyadhDate(new Date(paying.updated_at))
  const until = new Date(Date.parse(`${paidOn}T12:00:00+03:00`) + days * 86_400_000).toISOString().slice(0, 10)
  const elapsed = daysBetween(paidOn, riyadhDate(new Date()))
  return { refundable: days > 0 && elapsed <= days, first_payment: true, until: `${until}T23:59:59+03:00`, window_days: days }
}

/** Two refusals, because the vendor needs to know which rule stopped them. */
async function assertRefundable(client: Pick<Pool, 'query'>, customerId: string, invoiceId: string) {
  const eligibility = await refundEligibility(client, customerId, invoiceId)
  if (!eligibility.first_payment) throw new CommercialHttpError('refund_not_first_payment', 409)
  if (!eligibility.refundable) throw new CommercialHttpError('refund_window_closed', 409)
}
