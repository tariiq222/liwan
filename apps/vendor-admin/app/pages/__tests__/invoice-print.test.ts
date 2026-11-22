import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as Vue from 'vue'
import { fakeT, renderShared } from '@liwan/ui/test/helpers/renderShared'
import * as commercial from '@liwan/commercial-ui/app/utils/commercial'
import * as invoiceDocument from '@liwan/commercial-ui/app/utils/invoiceDocument'
import { invoiceStatusBadge } from '@liwan/commercial-ui/app/utils/commercialBadges'
import { mountPage } from '../../__tests__/pageHarness'
import * as subscriptions from '../../utils/vendorSubscriptions'
import * as ownerOnly from '../../utils/ownerOnly'
import * as stuckRefund from '../../utils/stuckRefund'
import * as vendorCommercial from '../../utils/vendorCommercial'
import { adjustmentStatusBadge, paymentAttemptBadge } from '../../utils/vendorBadges'
import { formatBusinessDate, formatBusinessDateTime } from '../../utils/vendorTime'

const mounted: { stop: () => void }[] = []
afterEach(() => mounted.splice(0).forEach(page => page.stop()))

const sar = (minor: number) => ({ currency: 'SAR', exponent: 2, minor })
const line = { key: 'base', kind: 'base', timing: 'now', description: 'الباقة الأساسية', quantity: 1, unit_amount: sar(20000), amount: sar(20000), period_start: '2026-10-02', period_end: '2026-11-02', source_revision_id: 'r' }
const seller = { legal_name_ar: 'شركة ليوان المحدودة', legal_name_en: 'Liwan Co.', commercial_registration: '1010000000', address: 'طريق العليا\nبرج 4', city: 'الرياض', country: 'السعودية', email: 'billing@liwan.example', phone: '+966110000000' }
const document = { id: 'inv1', number: 'INV-1001', customer_id: 'c1', subscription_id: 's1', order_id: 'o1', kind: 'renewal', status: 'issued', currency: 'SAR', lines: [line], subtotal: sar(20000), tax: sar(0), total: sar(20000),
  period_start: '2026-10-02', period_end: '2026-11-02', issued_at: '2026-10-01T22:00:00Z', due_at: null, paid_at: null, tax_label: null, official_tax_invoice: false, customer_name: 'شركة المثال للتجارة', seller, credit_notes: [] }

async function printPage(doc: unknown, query: Record<string, string> = {}) {
  const invoiceDocumentRead = vi.fn(async () => doc)
  const page = await mountPage('invoices/print/[id].vue', {
    ...subscriptions, useRoute: () => ({ params: { id: 'inv/1' }, query }), useVendorSubscriptions: () => ({ invoiceDocument: invoiceDocumentRead }),
  })
  mounted.push(page)
  return { page, invoiceDocumentRead }
}
const node = (captured: { name: string, props: Record<string, any> }[], name: string, testid?: string) => captured.find(entry => entry.name === name && (testid === undefined || entry.props['data-testid'] === testid))

describe('vendor invoice print route', () => {
  it('reads the printable document of the invoice and shows it with a print and a back action', async () => {
    const { page, invoiceDocumentRead } = await printPage(document)
    expect(invoiceDocumentRead).toHaveBeenCalledWith('inv/1')
    const { captured } = await page.rendered()
    expect(node(captured, 'SharedInvoiceDocument')?.props.invoice).toEqual(document)
    expect(node(captured, 'UButton', 'invoice-print-action')).toBeDefined()
  })

  it('goes back to the invoice and keeps the list or customer it was opened from', async () => {
    const { page } = await printPage(document, { returnTo: '/customers/c1?tab=invoices' })
    expect(node((await page.rendered()).captured, 'UButton', 'invoice-print-back')?.props.to).toEqual({ path: '/invoices/inv%2F1', query: { returnTo: '/customers/c1?tab=invoices' } })
    const other = await printPage(document, { returnTo: 'https://evil.example/' })
    expect(node((await other.page.rendered()).captured, 'UButton', 'invoice-print-back')?.props.to).toEqual({ path: '/invoices/inv%2F1', query: { returnTo: '/invoices' } })
  })

  it('does not print a draft: no document and no print action, only the way back', async () => {
    const { page } = await printPage({ ...document, status: 'draft', number: null })
    const { captured } = await page.rendered()
    expect(node(captured, 'SharedInvoiceDocument')).toBeUndefined()
    expect(node(captured, 'UButton', 'invoice-print-action')).toBeUndefined()
    expect(node(captured, 'UButton', 'invoice-print-back')).toBeDefined()
    expect(node(captured, 'SharedEmptyState')).toBeDefined()
  })
})

describe('invoice page print action', () => {
  async function invoicePage(overrides: Record<string, unknown>) {
    const invoice = { ...document, customer_name: 'x', refund: { refundable: false, first_payment: false, until: null, window_days: 0, locks_subscription: false }, adjustments: [], bank_transfer_claim: null, ...overrides }
    const api = { invoice: vi.fn(async () => invoice), paymentAttempts: vi.fn(async () => ({ items: [], total: 0 })) }
    const page = await mountPage('invoices/[id].vue', {
      ...subscriptions, ...ownerOnly, ...stuckRefund, ...vendorCommercial, invoiceStatusBadge, adjustmentStatusBadge, paymentAttemptBadge, formatCommercialMoney: commercial.formatCommercialMoney, formatBusinessDate, formatBusinessDateTime,
      useRoute: () => ({ params: { id: 'inv1' }, query: { returnTo: '/invoices?status=issued' } }), useVendorSubscriptions: () => api, useVendorContext: () => ({ can: () => true }), useCopyLink: () => ({ copy: vi.fn(), outcomeFor: () => null }),
    })
    mounted.push(page)
    return page
  }

  it('opens the print route for an issued invoice, keeping the way back', async () => {
    const { captured } = await (await invoicePage({})).rendered()
    expect(node(captured, 'UButton', 'invoice-print-open')?.props.to).toEqual({ path: '/invoices/print/inv1', query: { returnTo: '/invoices?status=issued' } })
  })

  it('offers nothing to print for a draft', async () => {
    const { captured } = await (await invoicePage({ status: 'draft', number: null })).rendered()
    expect(node(captured, 'UButton', 'invoice-print-open')).toBeUndefined()
  })
})

describe('the document the console prints', () => {
  const localeFile = (lang: 'ar' | 'en') => resolve(import.meta.dirname, `../../../../../packages/commercial-ui/i18n/locales/${lang}/commercial.json`)
  const flat = (prefix: string, value: unknown, out: Record<string, string>) => {
    if (typeof value === 'string') out[prefix] = value
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) flat(prefix ? `${prefix}.${k}` : k, v, out)
    return out
  }
  const messages = (lang: 'ar' | 'en') => ({ ...flat('', JSON.parse(readFileSync(localeFile(lang), 'utf8')), {}), 'app.productName': lang === 'ar' ? 'ليوان' : 'LiwanOS' })
  const FORBIDDEN = /tax invoice|فاتورة ضريبية|vat number|الرقم الضريبي|before tax|قبل الضريبة|\bqr\b|provider_ref|operator|internal/i
  const lines = Vue.defineComponent({ props: { lines: Array, totals: Array }, setup: props => () => Vue.h('div', (props.totals as { label: string }[]).map(total => Vue.h('p', total.label))) })
  const render = (lang: 'ar' | 'en', invoice: Record<string, unknown>) => renderShared(resolve(import.meta.dirname, '../../../../../packages/commercial-ui/app/components/shared/data/InvoiceDocument.vue'), { invoice }, {}, {
    messages: messages(lang), globals: { useI18n: () => ({ t: fakeT(messages(lang)), locale: Vue.ref(lang) }) }, stubs: { SharedInvoiceLines: lines }, modules: { '../../../utils/commercial': commercial, '../../../utils/invoiceDocument': invoiceDocument },
  })

  it.each(['ar', 'en'] as const)('renders in %s with the seller, the Riyadh day and none of the words a tax invoice would carry', async (lang) => {
    const html = await render(lang, { ...document, credit_notes: [{ id: 'n1', amount: sar(1000), cause: 'vendor_refund', status: 'pending', created_at: '2026-10-05T08:00:00Z', refunded_at: null, refund_reference: null }] })
    expect(html).toContain(lang === 'ar' ? 'شركة ليوان المحدودة' : 'Liwan Co.')
    expect(html).toContain('02/10/2026')
    expect(html).toContain('INV-1001')
    expect(html).not.toMatch(FORBIDDEN)
  })
})
