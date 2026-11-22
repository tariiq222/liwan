import type { RefundConflict, ReturnedRefundResolution } from '@liwan/commercial-contracts'
import type { VendorAdjustment } from './vendorSubscriptions'

/**
 * Whether the stuck automatic refund actions belong on a note: a pending credit note the server marked stuck (the refund row holds an
 * `attempted` or `returned` mark), shown to an account that may manage billing. Every other note shows none of the three actions.
 */
export const showsStuckRefund = (note: Pick<VendorAdjustment, 'kind' | 'status' | 'automatic_refund'>, canBilling: boolean): boolean =>
  canBilling && note.kind === 'credit_note' && note.status === 'pending' && Boolean(note.automatic_refund?.stuck)

/**
 * The ways the operator may close a returned refund. Recording is always offered. Closing the note as already recorded needs the conflicting
 * note to be settled, on the same invoice, and to cover at least this note; the server refuses it otherwise, so the page does not offer it.
 */
export function recordResolutions(note: Pick<VendorAdjustment, 'amount'>, conflict: RefundConflict | null): ReturnedRefundResolution[] {
  return conflict && conflict.same_invoice && conflict.status === 'refunded' && conflict.amount.minor >= note.amount.minor ? ['record', 'already_recorded'] : ['record']
}
