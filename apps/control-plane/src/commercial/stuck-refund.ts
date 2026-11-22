import type { Pool } from 'pg'
import { refundConflictSchema, stuckRefundSchema, type StuckRefund, type StuckRefundAction } from '@liwan/commercial-contracts'
import type { SystemRefund } from './settlements.js'

type Q = Pick<Pool, 'query'>

/** A pending automatic refund whose row holds a mark: the only rows the operator may check, release or record. */
export const isStuckRefund = (refund: SystemRefund) => refund.status === 'pending' && (refund.provider_refund === 'attempted' || refund.provider_refund === 'returned')

/**
 * The actions the operator is offered for a stuck row of one note. `record` is for the note the row names (a vendor-requested refund): the
 * order-level row of an undelivered order records through the worker's own order settlement, which the operator never repeats.
 */
function allowedActions(noteId: string, refund: SystemRefund): StuckRefundAction[] {
  if (refund.provider_refund === 'attempted') return ['check', 'release']
  return refund.adjustment_id === noteId ? ['check', 'record'] : ['check']
}

/** The note that already holds the payment id as its refund reference, or null. */
async function conflictOf(db: Q, noteId: string, invoiceId: string, paymentId: string | null) {
  if (!paymentId) return null
  const row = (await db.query(`SELECT n.id,n.invoice_id,i.number,n.amount_minor,n.currency,n.exponent,n.cause,n.status,n.refunded_by,n.refunded_at
    FROM invoice_adjustments n JOIN invoices i ON i.id=n.invoice_id WHERE n.refund_reference=$1 AND n.id<>$2`, [paymentId, noteId])).rows[0]
  return row ? refundConflictSchema.parse({ adjustment_id: row.id, invoice_id: row.invoice_id, invoice_number: row.number ?? null,
    amount: { currency: row.currency, exponent: Number(row.exponent), minor: Number(row.amount_minor) }, cause: row.cause, status: row.status,
    refunded_by: row.refunded_by ?? null, refunded_at: row.refunded_at ? new Date(row.refunded_at).toISOString() : null, same_invoice: row.invoice_id === invoiceId }) : null
}

/** The stuck detail of each note whose refund row is stuck (keyed by note id); every other note has none. Only stuck rows pay for a read. */
export async function stuckRefundViews(db: Q, notes: { id: string; invoice_id: string }[], refunds: Map<string, SystemRefund>): Promise<Map<string, StuckRefund>> {
  const out = new Map<string, StuckRefund>()
  for (const note of notes) {
    const refund = refunds.get(note.id)
    if (!refund || !isStuckRefund(refund)) continue
    out.set(note.id, stuckRefundSchema.parse({ since: refund.created_at.toISOString(), attempts: refund.attempts, next_attempt_at: refund.next_attempt_at.toISOString(),
      provider_payment_id: refund.provider_payment_id, conflict: refund.provider_refund === 'returned' ? await conflictOf(db, note.id, note.invoice_id, refund.provider_payment_id) : null,
      actions: allowedActions(note.id, refund) }))
  }
  return out
}
