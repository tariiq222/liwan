import type { SalesInvoiceKind, SalesInvoicingStatus, SalesOrderInvoice } from '@liwan/contracts'
import type { StatusTone } from '@liwan/ui/app/utils/statusTone'

/** The badge tone of where an order stands with its invoices. */
export const INVOICING_STATUS_TONE: Record<SalesInvoicingStatus, StatusTone> = { none: 'neutral', to_invoice: 'info', partial: 'warning', invoiced: 'success' }

/** The badge tone of the state of one invoice. */
export const INVOICE_STATE_TONE: Record<SalesOrderInvoice['state'], StatusTone> = { draft: 'neutral', posted: 'success', cancel: 'destructive' }

/**
 * The `Idempotency-Key` of the invoice requests of one form: one key per attempt, kept while the same body is sent again for
 * the same order (a retry after a lost answer replays the first request instead of making a second invoice) and renewed
 * when the order or the body changes (the server refuses a key reused for another body) and after a success (`settle`).
 */
export function createInvoiceAttempts(make: () => string = () => crypto.randomUUID()) {
  let current: { order: number; body: string; key: string } | null = null
  return {
    keyFor(order: number, body: unknown): string {
      const text = JSON.stringify(body)
      if (!current || current.order !== order || current.body !== text) current = { order, body: text, key: make() }
      return current.key
    },
    settle() { current = null },
  }
}

/** The finance page of an invoice or a down payment (a sales invoice) or of a credit note, which is where the order links to. */
export function salesInvoicePath(kind: SalesInvoiceKind, id: number): string {
  return kind === 'credit_note' ? `/finance/sales/credit-notes/${id}` : `/finance/sales/invoices/${id}`
}
