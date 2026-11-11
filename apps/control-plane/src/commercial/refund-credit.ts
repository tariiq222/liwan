/**
 * What an invoice has already credited, in one definition for the refund worker and the vendor attention list: every
 * non-void credit note counts whatever its origin (an operator-requested refund and a provider-refund note are the same
 * money), and only a duplicate-charge note is left out because it credits a different attempt's payment. Used as a SQL
 * fragment so the two callers cannot drift apart.
 */

/** Why a credit note exists: the typed fact `invoice_adjustments.cause` stores. The free-text `reason` only explains it to a person. */
export const CREDIT_NOTE_CAUSES = ['vendor_refund', 'duplicate_payment', 'provider_refund', 'payment_after_cancellation', 'automatic_refund', 'fulfillment_failure'] as const
export type CreditNoteCause = typeof CREDIT_NOTE_CAUSES[number]

/** A scalar subquery: the minor-unit total credited on the invoice the `invoiceId` SQL expression names. */
export const creditedMinorSql = (invoiceId: string) => `(SELECT COALESCE(sum(ia.amount_minor),0) FROM invoice_adjustments ia
  WHERE ia.invoice_id=${invoiceId} AND ia.kind='credit_note' AND ia.status<>'void' AND ia.cause<>'duplicate_payment')`
