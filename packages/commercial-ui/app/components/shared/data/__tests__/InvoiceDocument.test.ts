import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'
import * as commercial from '../../../../utils/commercial'
import * as invoiceDocument from '../../../../utils/invoiceDocument'

const component = resolve(import.meta.dirname, '../InvoiceDocument.vue')
const localeFile = (lang: 'ar' | 'en') => resolve(import.meta.dirname, `../../../../../i18n/locales/${lang}/commercial.json`)

function flatten(prefix: string, value: unknown, out: Record<string, string>) {
  if (typeof value === 'string') out[prefix] = value
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) flatten(prefix ? `${prefix}.${k}` : k, v, out)
}
const messages = (lang: 'ar' | 'en') => { const out: Record<string, string> = {}; flatten('', JSON.parse(readFileSync(localeFile(lang), 'utf8')), out); return out }

// The shared lines table is its own tested component: here it only shows what the document hands it.
const SharedInvoiceLines = Vue.defineComponent({
  props: { lines: Array, totals: Array },
  setup: props => () => Vue.h('div', [
    ...(props.lines as { description: string, amount: string }[]).map(l => Vue.h('p', { 'data-testid': 'line' }, `${l.description} ${l.amount}`)),
    ...((props.totals ?? []) as { label: string, value: string }[]).map(t => Vue.h('p', { 'data-testid': 'total' }, `${t.label} ${t.value}`)),
  ]),
})
const sar = (minor: number) => ({ currency: 'SAR', exponent: 2, minor })
const line = { key: 'base', kind: 'base', timing: 'now', description: 'الباقة الأساسية', quantity: 1, unit_amount: sar(20000), amount: sar(20000), period_start: '2026-10-02', period_end: '2026-11-02', source_revision_id: 'r' }
const invoice = { id: 'inv1', number: 'INV-1001', customer_id: 'c1', subscription_id: 's1', order_id: null, kind: 'renewal', status: 'issued', currency: 'SAR', lines: [line, { ...line, key: 'branch', description: 'فرع إضافي', amount: sar(6000) }], subtotal: sar(26000), tax: sar(0), total: sar(26000), period_start: '2026-10-02', period_end: '2026-11-02', issued_at: '2026-10-02T09:00:00Z', due_at: null, paid_at: null, tax_label: null, official_tax_invoice: false }
const seller = { legal_name_ar: 'شركة ليوان المحدودة', legal_name_en: 'Liwan Co.', commercial_registration: '1010000000', address: 'طريق العليا\nبرج 4', city: 'الرياض', country: 'السعودية', email: 'billing@liwan.example', phone: '+966110000000' }
const note = (status: 'pending' | 'applied' | 'refunded', amount: number) => ({ id: 'n1', amount: sar(amount), cause: 'vendor_refund', status, created_at: '2026-10-05T08:00:00Z', refunded_at: status === 'refunded' ? '2026-10-06T08:00:00Z' : null, refund_reference: status === 'refunded' ? 'BANK-4471' : null })
const full = (extra: Record<string, unknown> = {}) => ({ ...invoice, customer_name: 'شركة المثال للتجارة', seller, credit_notes: [], ...extra })
const render = (extra: Record<string, unknown> = {}, lang: 'ar' | 'en' = 'ar') => renderShared(component, { invoice: full(extra) }, {}, {
  messages: { ...messages(lang), 'app.productName': 'ليوان' },
  stubs: { SharedInvoiceLines },
  modules: { '../../../utils/commercial': commercial, '../../../utils/invoiceDocument': invoiceDocument },
})

describe('InvoiceDocument', () => {
  it('prints seller, buyer, number, dates, lines, total and state', async () => {
    const html = await render({ status: 'paid', paid_at: '2026-10-03T09:00:00Z', due_at: '2026-10-16' })
    expect(html).toContain('شركة ليوان المحدودة')
    expect(html).toContain('1010000000')
    expect(html).toContain('billing@liwan.example')
    expect(html).toContain('برج 4')
    expect(html).toContain('شركة المثال للتجارة')
    expect(html).toContain('INV-1001')
    expect(html).toContain('02/10/2026')
    expect(html).toContain('16/10/2026')
    expect(html).toContain('03/10/2026')
    expect(html.replace(/[\u2066\u2069]/g, '')).toContain('02/10/2026 → 02/11/2026')
    expect(html).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(html).toContain('الباقة الأساسية')
    expect(html).toContain('فرع إضافي')
    expect(html).toContain('data-testid="total"')
    expect(html).toContain('مدفوعة')
  })

  it('falls back to the product name without a seller identity', async () => {
    const bare = await render({ seller: null })
    expect(bare).toContain('data-testid="invoice-seller-name"')
    expect(bare).not.toContain('شركة ليوان المحدودة')
    expect(bare).not.toContain('invoice-seller-line')
  })

  it('lists credit notes with date, reason label, reference, status and the net amount', async () => {
    const html = await render({ status: 'paid', credit_notes: [note('refunded', 10000)] })
    expect(html).toContain('data-testid="invoice-credit-note"')
    expect(html).toContain('استرداد بطلبك')
    expect(html).toContain('BANK-4471')
    expect(html).toContain('06/10/2026')
    expect(html).toContain('تم الاسترداد')
    expect(html).toContain('data-testid="invoice-net"')
    expect(html).not.toContain('vendor_refund')
    expect(html).not.toContain('مستردة')
  })

  it('says refunded once the credit covers the invoice and was refunded, credit pending while it was not', async () => {
    expect(await render({ status: 'credit_pending', credit_notes: [note('refunded', 26000)] })).toContain('data-testid="invoice-state">مستردة')
    const pending = await render({ status: 'credit_pending', credit_notes: [note('pending', 26000)] })
    expect(pending).toContain('data-testid="invoice-state">إشعار دائن معلّق')
    expect(pending).toContain('الاسترداد معلّق')
  })

  it('carries no credit-note section without credit notes and no due or paid date it does not have', async () => {
    const html = await render({ status: 'credit_pending' })
    expect(html).not.toContain('invoice-credit-notes')
    expect(html).not.toContain('تاريخ الاستحقاق')
    expect(html).not.toContain('تاريخ السداد')
  })

  it('prints the Riyadh day of every instant, not the UTC day', async () => {
    // 01:00 on 2 October in Riyadh is 22:00 UTC on 1 October.
    const html = await render({ status: 'paid', issued_at: '2026-10-01T22:00:00Z', paid_at: '2026-10-01T20:30:00Z', due_at: '2026-10-15T21:00:00Z', credit_notes: [{ ...note('refunded', 100), refunded_at: '2026-10-06T22:30:00Z' }] })
    expect(html).toContain('02/10/2026')
    expect(html).toContain('01/10/2026')
    expect(html).toContain('16/10/2026')
    expect(html).toContain('07/10/2026')
    expect(html).not.toContain('15/10/2026')
    expect(html).not.toContain('06/10/2026')
  })

  it('shows subtotal, tax and total only when the invoice names a tax', async () => {
    const html = await render({ tax_label: 'VAT 15% exclusive', tax: sar(3900), total: sar(29900) })
    expect(html.match(/data-testid="total"/g)).toHaveLength(3)
  })

  it('carries no tax wording for an untaxed invoice, in either language', async () => {
    for (const lang of ['ar', 'en'] as const) {
      const html = await render({ credit_notes: [note('refunded', 100)] }, lang)
      expect(html.match(/data-testid="total"/g)).toHaveLength(1)
      expect(html).not.toMatch(/tax|vat|zatca|qr|ضريب|زكاة/i)
    }
  })
})
