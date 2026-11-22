import { riyadhDate, type CustomerInvoice, type Invoice, type Money } from '@liwan/commercial-contracts'
import { formatCommercialMoney } from './commercial'
import { invoiceLineQuantities, type InvoiceLineView } from './invoiceLines'

type Translate = (key: string) => string

/** The invoice's lines and totals as SharedInvoiceLines draws them: list lines (× quantity · free · paid), the "not official" notice and the totals. */
export function invoiceLinesView(invoice: Invoice, t: Translate, locale: string) {
  const money = (value: Invoice['total']) => formatCommercialMoney(value, locale)
  const lines: InvoiceLineView[] = invoice.lines.map((line) => {
    const q = invoiceLineQuantities(line)
    return {
      id: line.key,
      // Metered quantities are UI labels, not stored descriptions; the priced revision names the rest.
      description: line.kind === 'users' ? t('commercial.invoice.users') : line.kind === 'storage' ? t('commercial.invoice.storage') : line.description,
      cells: [
        { key: 'quantity', label: '', value: `× ${line.quantity}` },
        ...(q.free === null ? [] : [
          { key: 'free', label: t('commercial.invoice.free'), value: String(q.free) },
          { key: 'paid', label: t('commercial.invoice.paidQty'), value: String(q.paid) },
        ]),
      ],
      amount: money(line.amount),
    }
  })
  return {
    lines,
    notice: t('commercial.invoice.notOfficial'),
    totals: [
      { label: t('commercial.invoice.subtotal'), value: money(invoice.subtotal) },
      // Liwan is not VAT-registered (owner decision 2026-11-06): an untaxed invoice shows no tax row at all.
      ...(invoice.tax_label === null ? [] : [{ label: t('commercial.invoice.tax'), value: money(invoice.tax) }]),
      { label: t('commercial.invoice.total'), value: money(invoice.total) },
    ],
  }
}

/** The Riyadh calendar day (`YYYY-MM-DD`) of an invoice instant, the one day both apps print (owner decision 2026-11-22). */
export const invoiceDay = (value: string | null): string | null => value ? riyadhDate(value) : null

export type InvoicePrintState = 'draft' | 'issued' | 'paid' | 'void' | 'credit_pending' | 'refunded'

/**
 * What the credit notes do to an invoice: what they credit, what is left, and the state line to print. Every non-void
 * credit note counts (the server sends no void ones). The invoice reads "refunded" only once the credit covers the whole
 * total and every note has been refunded; covered but not yet refunded stays "credit note pending".
 */
export function invoiceCreditSummary(invoice: Pick<CustomerInvoice, 'status' | 'total' | 'credit_notes'>): { credited: Money; net: Money; state: InvoicePrintState } {
  const creditedMinor = invoice.credit_notes.reduce((sum, note) => sum + note.amount.minor, 0)
  const covered = invoice.total.minor > 0 && creditedMinor >= invoice.total.minor
  const state: InvoicePrintState = covered
    ? (invoice.credit_notes.every(note => note.status === 'refunded') ? 'refunded' : 'credit_pending')
    : invoice.status
  return {
    credited: { ...invoice.total, minor: creditedMinor },
    net: { ...invoice.total, minor: Math.max(0, invoice.total.minor - creditedMinor) },
    state,
  }
}

/** The seller's legal name in the reader's language, falling back to the other one. */
export function sellerLegalName(seller: NonNullable<CustomerInvoice['seller']>, locale: string): string {
  return (locale.startsWith('ar') ? seller.legal_name_ar || seller.legal_name_en : seller.legal_name_en || seller.legal_name_ar)
}
