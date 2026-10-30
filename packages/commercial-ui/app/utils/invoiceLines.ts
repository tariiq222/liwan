import type { StatusTone } from '@liwan/ui/app/utils/statusTone'

/** One invoice line as SharedInvoiceLines draws it: every label translated and every amount formatted by the caller. */
export interface InvoiceLineView {
  id: string | number
  description: string
  kind?: { label: string; tone: StatusTone }
  cells: { key: string; label: string; value: string }[]
  amount: string
}

/**
 * The free and paid counts of an invoice line follow the invoice contract:
 * `quantity` is the billed quantity and the line's
 * amount is `quantity × unit`, so the paid count is `quantity`. `free_quantity` is informational
 * and is never subtracted. Absent means "unknown", which callers show as not available, never 0.
 */
export function invoiceLineQuantities(line: { quantity: number; free_quantity?: number }): { free: number | null; paid: number } {
  return { free: line.free_quantity === undefined ? null : line.free_quantity, paid: line.quantity }
}
