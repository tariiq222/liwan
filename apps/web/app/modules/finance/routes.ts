import type { FinanceInvoice } from '@webvue/contracts'

/** The record page of an invoice-like document, by its move type. Receipts open with their invoice or bill family. */
const RECORD_FOLDERS: Record<FinanceInvoice['move_type'], string> = {
  out_invoice: '/finance/sales/invoices',
  out_receipt: '/finance/sales/invoices',
  out_refund: '/finance/sales/credit-notes',
  in_invoice: '/finance/purchases/bills',
  in_receipt: '/finance/purchases/bills',
  in_refund: '/finance/purchases/refunds',
}

export function invoiceRecordPath(moveType: FinanceInvoice['move_type'], id: number): string {
  return `${RECORD_FOLDERS[moveType]}/${id}`
}

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`)

/** The part of the finance sidebar a path opens: a section with a sub-list, or a plain page. */
export type FinanceSection = 'overview' | 'sales' | 'purchases' | 'payments' | 'partners' | 'accounting' | 'bank' | 'reports'

export function financeSectionOf(path: string | undefined): FinanceSection {
  const pathname = path?.split(/[?#]/, 1)[0] ?? ''
  for (const section of ['sales', 'purchases', 'payments', 'partners', 'accounting', 'bank', 'reports'] as const) {
    if (under(pathname, `/finance/${section}`)) return section
  }
  return 'overview'
}

/** Whether a sidebar target is lit for `path`: the overview only on itself, a section across its pages, a leaf list without its create form. */
export function financeNavActive(path: string, target: string): boolean | undefined {
  // A link that carries a filter query only jumps to another section; it never claims the current page.
  if (target.includes('?')) return false
  if (target === '/finance') return path === '/finance'
  if (['/finance/sales', '/finance/purchases', '/finance/payments', '/finance/partners', '/finance/accounting', '/finance/bank', '/finance/reports'].includes(target)) return under(path, target)
  if (['/finance/sales/invoices', '/finance/sales/credit-notes', '/finance/purchases/bills', '/finance/purchases/refunds', '/finance/accounting/entries', '/finance/bank/statements'].includes(target)) {
    return under(path, target) && path !== `${target}/new`
  }
  return undefined
}
