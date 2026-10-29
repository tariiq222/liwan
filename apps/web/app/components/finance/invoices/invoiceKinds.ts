import type { FinanceInvoice } from '@webvue/contracts'

/** The four document types the Finance app edits; receipts have no page. */
export type FinanceMoveType = 'out_invoice' | 'out_refund' | 'in_invoice' | 'in_refund'

export interface InvoiceKind {
  moveType: FinanceMoveType
  /** The list page; the create panel is `${listPath}/new` and a record `${listPath}/{id}`. */
  listPath: string
  /** Which partners the document picker offers. */
  partnerKind: 'customer' | 'vendor'
  /** Money flows in for customer invoices and vendor refunds, out for the other two. */
  direction: 'inbound' | 'outbound'
}

export const INVOICE_KINDS: Record<FinanceMoveType, InvoiceKind> = {
  out_invoice: { moveType: 'out_invoice', listPath: '/finance/sales/invoices', partnerKind: 'customer', direction: 'inbound' },
  out_refund: { moveType: 'out_refund', listPath: '/finance/sales/credit-notes', partnerKind: 'customer', direction: 'outbound' },
  in_invoice: { moveType: 'in_invoice', listPath: '/finance/purchases/bills', partnerKind: 'vendor', direction: 'outbound' },
  in_refund: { moveType: 'in_refund', listPath: '/finance/purchases/refunds', partnerKind: 'vendor', direction: 'inbound' },
}

/** The type of the document a credit note or refund reverses: a credit note's origin is a customer invoice, a refund's a bill. */
export function reversedMoveType(moveType: FinanceInvoice['move_type']): FinanceInvoice['move_type'] {
  return moveType === 'out_refund' ? 'out_invoice' : moveType === 'in_refund' ? 'in_invoice' : moveType
}

export function invoiceKindOf(moveType: FinanceInvoice['move_type']): InvoiceKind | null {
  return moveType in INVOICE_KINDS ? INVOICE_KINDS[moveType as FinanceMoveType] : null
}

export function invoiceRecordPath(moveType: FinanceInvoice['move_type'], id: number): string {
  return `${(invoiceKindOf(moveType) ?? INVOICE_KINDS.out_invoice).listPath}/${id}`
}

/** The label to show for a document that has no number yet. */
export function invoiceTitle(invoice: Pick<FinanceInvoice, 'id' | 'name'>, draftLabel: string): string {
  return invoice.name || `${draftLabel} #${invoice.id}`
}
