/**
 * What an invoice has already credited, in one definition for the refund worker and the vendor attention list: every
 * non-void credit note counts whatever its origin (an operator-requested refund and a provider-refund note are the same
 * money), and only a duplicate-charge note is left out because it credits a different attempt's payment. Used as a SQL
 * fragment so the two callers cannot drift apart.
 */
export const DUPLICATE_PAYMENT_REASON = 'duplicate payment — manual review'

/** A scalar subquery: the minor-unit total credited on the invoice the `invoiceId` SQL expression names. */
export const creditedMinorSql = (invoiceId: string) => `(SELECT COALESCE(sum(ia.amount_minor),0) FROM invoice_adjustments ia
  WHERE ia.invoice_id=${invoiceId} AND ia.kind='credit_note' AND ia.status<>'void' AND ia.reason NOT LIKE '${DUPLICATE_PAYMENT_REASON}%')`
