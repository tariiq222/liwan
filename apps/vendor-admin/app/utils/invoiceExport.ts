import { INVOICE_EXPORT_MAX_ROWS, riyadhDate } from '@liwan/commercial-contracts'
import type { InvoiceExport, Money } from '@liwan/commercial-contracts'
import { csvLiteral, toCsvTable, type CsvCell } from './csv'
import { invoiceListQuery, type VendorInvoice } from './vendorSubscriptions'

/** The list route answers at most 200 rows a page; the export reads one page after another by offset. */
export const INVOICE_EXPORT_PAGE = 200

/** The columns of the file, in order; the console's language names each one (`vendor.invoices.export.columns.<name>`). */
export const INVOICE_EXPORT_COLUMNS = ['number', 'customer', 'kind', 'status', 'issued', 'due', 'paid', 'periodStart', 'periodEnd', 'currency', 'subtotal', 'tax', 'total', 'credited', 'invoiceId', 'customerId'] as const

export interface InvoiceExportFilters { customerId: string, status: string }
export interface InvoiceExportProgress { done: number, total: number }
type ReadPage = (query: ReturnType<typeof invoiceListQuery>) => Promise<{ items: VendorInvoice[], total: number }>

/**
 * Every invoice matching the filters, newest first, up to the cap. The first answer's total says how many to expect; a repeated id
 * (a new invoice shifts every later offset) is dropped, and reading goes on until that many are in or the list ends. A failed
 * page rejects with no rows, and an aborted signal stops before the next request.
 */
export async function collectInvoices(
  readPage: ReadPage,
  filters: InvoiceExportFilters,
  { signal, onProgress }: { signal?: AbortSignal, onProgress?: (progress: InvoiceExportProgress) => void },
): Promise<{ rows: VendorInvoice[], total: number, partial: boolean }> {
  const rows = new Map<string, VendorInvoice>()
  let total = 0
  for (let index = 0; ; index++) {
    signal?.throwIfAborted()
    const page = await readPage(invoiceListQuery({ customerId: filters.customerId, status: filters.status, page: index + 1, pageSize: INVOICE_EXPORT_PAGE }))
    signal?.throwIfAborted()
    if (index === 0) total = page.total
    const wanted = Math.min(total, INVOICE_EXPORT_MAX_ROWS)
    for (const item of page.items) if (rows.size < wanted && !rows.has(item.id)) rows.set(item.id, item)
    onProgress?.({ done: rows.size, total: wanted })
    if (rows.size >= wanted || page.items.length === 0 || (index + 1) * INVOICE_EXPORT_PAGE >= page.total) break
  }
  return { rows: [...rows.values()], total, partial: total > INVOICE_EXPORT_MAX_ROWS }
}

/** An amount as a plain number: Latin digits, a dot, the currency's decimals, no symbol or separator. */
export function plainAmount({ minor, exponent }: Money): string {
  const digits = String(Math.abs(minor)).padStart(exponent + 1, '0')
  const whole = digits.slice(0, digits.length - exponent)
  return `${minor < 0 ? '-' : ''}${exponent === 0 ? whole : `${whole}.${digits.slice(digits.length - exponent)}`}`
}

/** What the credit notes took off: the applied and refunded ones; a pending or void note has not. */
function credited(invoice: VendorInvoice): Money {
  const minor = invoice.adjustments.filter(note => note.kind === 'credit_note' && (note.status === 'applied' || note.status === 'refunded')).reduce((sum, note) => sum + note.amount.minor, 0)
  return { ...invoice.total, minor }
}

const day = (value: string | null): CsvCell => (value ? csvLiteral(riyadhDate(value)) : null)
const amount = (money: Money): CsvCell => csvLiteral(plainAmount(money))

/** One row per invoice. The headers and the kind and status labels come from the console language; dates are the Riyadh day. */
export function invoiceExportCsv(
  rows: readonly VendorInvoice[],
  labels: { header: readonly string[], kind: (kind: string) => string, status: (status: string) => string },
): string {
  return toCsvTable(labels.header, rows.map(invoice => [
    invoice.number, invoice.customer_name, labels.kind(invoice.kind), labels.status(invoice.status),
    day(invoice.issued_at), day(invoice.due_at), day(invoice.paid_at), csvLiteral(invoice.period_start), csvLiteral(invoice.period_end),
    invoice.currency, amount(invoice.subtotal), amount(invoice.tax), amount(invoice.total), amount(credited(invoice)), invoice.id, invoice.customer_id,
  ]))
}

/** What the control plane records of an export: the filters in force and the number of rows in the file. */
export function invoiceExportAudit(filters: InvoiceExportFilters, rowCount: number): InvoiceExport {
  return { ...(filters.customerId ? { customer_id: filters.customerId } : {}), ...(filters.status !== 'all' ? { status: filters.status as InvoiceExport['status'] } : {}), row_count: rowCount }
}

export const invoiceExportFileName = (status: string, today: string, partial: boolean): string =>
  `liwan-invoices-${status}-${today}${partial ? '-partial' : ''}.csv`
