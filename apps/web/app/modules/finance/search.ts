import { FinanceInvoiceListSchema, FinancePartnerListSchema } from '@liwan/contracts'
import type { AppSearchProvider } from '../types'
import { invoiceRecordPath } from './routes'

const PAGE = 20

/** Customers and vendors whose name, VAT or commercial registration match `q`, twenty at a time. */
export const partnersSearch: AppSearchProvider = {
  id: 'finance-partners',
  labelKey: 'finance.nav.partners',
  capability: 'finance.partners.read',
  icon: 'i-lucide-contact',
  serverSearch: true,
  queryKey: q => ['search', 'finance-partners', q],
  async search(api, q, offset) {
    const page = await api('/api/v1/finance/partners', { query: { q, limit: PAGE, offset }, schema: FinancePartnerListSchema })
    return {
      rows: page.items.map(partner => ({ id: partner.id, label: partner.name, to: `/finance/partners/${partner.id}`, caption: partner.vat || undefined })),
      total: page.total,
    }
  },
}

/** Invoices, bills and credit notes whose number, reference or partner match `q`. A draft has no number yet, so its row shows the partner. */
export const invoicesSearch: AppSearchProvider = {
  id: 'finance-invoices',
  labelKey: 'finance.nav.invoicesAll',
  capability: 'finance.invoices.read',
  icon: 'i-lucide-receipt-text',
  serverSearch: true,
  queryKey: q => ['search', 'finance-invoices', q],
  async search(api, q, offset) {
    const page = await api('/api/v1/finance/invoices', { query: { q, limit: PAGE, offset }, schema: FinanceInvoiceListSchema })
    return {
      rows: page.items.map(invoice => ({
        id: invoice.id,
        label: invoice.name ?? invoice.partner?.name ?? String(invoice.id),
        to: invoiceRecordPath(invoice.move_type, invoice.id),
        caption: invoice.name && invoice.partner ? invoice.partner.name : undefined,
      })),
      total: page.total,
    }
  },
}
