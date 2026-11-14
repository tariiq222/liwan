import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'
import * as subscriptionUtils from '../../../utils/subscription'
import { invoice } from '../../../../stories/subscription/fixtures'

const root = resolve(import.meta.dirname, '../../../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const component = resolve(import.meta.dirname, '../InvoiceDocument.vue')

function flatten(prefix: string, value: unknown, out: Record<string, string>) {
  if (typeof value === 'string') out[prefix] = value
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) flatten(prefix ? `${prefix}.${k}` : k, v, out)
}
const messages = (lang: 'ar' | 'en') => { const out: Record<string, string> = {}; flatten('', JSON.parse(read(`i18n/locales/${lang}/subscription.json`)), out); return out }

// The shared lines table is its own tested component: here it only shows what the document hands it.
const SharedInvoiceLines = Vue.defineComponent({
  props: { lines: Array, totals: Array },
  setup: props => () => Vue.h('div', [
    ...(props.lines as { description: string, amount: string }[]).map(l => Vue.h('p', { 'data-testid': 'line' }, `${l.description} ${l.amount}`)),
    ...((props.totals ?? []) as { label: string, value: string }[]).map(t => Vue.h('p', { 'data-testid': 'total' }, `${t.label} ${t.value}`)),
  ]),
})
const sar = (minor: number) => ({ currency: 'SAR', exponent: 2, minor })
const seller = { legal_name_ar: 'شركة ليوان المحدودة', legal_name_en: 'Liwan Co.', commercial_registration: '1010000000', address: 'طريق العليا\nبرج 4', city: 'الرياض', country: 'السعودية', email: 'billing@liwan.example', phone: '+966110000000' }
const note = (status: 'pending' | 'applied' | 'refunded', amount: number) => ({ id: 'n1', amount: sar(amount), cause: 'vendor_refund', status, created_at: '2026-10-05T08:00:00Z', refunded_at: status === 'refunded' ? '2026-10-06T08:00:00Z' : null, refund_reference: status === 'refunded' ? 'BANK-4471' : null })
const full = (extra: Record<string, unknown> = {}) => ({ ...invoice, customer_name: 'شركة المثال للتجارة', seller, credit_notes: [], ...extra })
const render = (extra: Record<string, unknown> = {}, lang: 'ar' | 'en' = 'ar') => renderShared(component, { invoice: full(extra) }, {}, {
  messages: messages(lang),
  stubs: { SharedInvoiceLines },
  modules: { '@/utils/subscription': subscriptionUtils },
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
    expect(html).toContain('2026-10-02')
    expect(html).toContain('2026-10-16')
    expect(html).toContain('2026-10-03')
    expect(html).toContain('الباقة الأساسية')
    expect(html).toContain('فرع إضافي')
    expect(html).toContain('data-testid="total"')
    expect(html).toContain('مدفوعة')
  })

  it('names the seller in the reader\'s language and falls back to the product name without an identity', async () => {
    expect(subscriptionUtils.sellerLegalName(seller, 'en')).toBe('Liwan Co.')
    expect(subscriptionUtils.sellerLegalName(seller, 'ar')).toBe('شركة ليوان المحدودة')
    expect(subscriptionUtils.sellerLegalName({ ...seller, legal_name_en: '' }, 'en')).toBe('شركة ليوان المحدودة')
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
    expect(html).toContain('2026-10-06')
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

  it('carries no tax wording for an untaxed invoice, in either language', async () => {
    for (const lang of ['ar', 'en'] as const) {
      const html = await render({ credit_notes: [note('refunded', 100)] }, lang)
      expect(html.match(/data-testid="total"/g)).toHaveLength(1)
      expect(html).not.toMatch(/tax|vat|zatca|qr|ضريب|زكاة/i)
    }
  })
})

describe('credit summary', () => {
  it('nets the credit off the total and never goes below zero', () => {
    expect(subscriptionUtils.invoiceCreditSummary(full({ credit_notes: [note('refunded', 10000)] }) as never)).toMatchObject({ credited: sar(10000), net: sar(16000), state: 'issued' })
    expect(subscriptionUtils.invoiceCreditSummary(full({ credit_notes: [note('refunded', 99999)] }) as never)).toMatchObject({ net: sar(0), state: 'refunded' })
  })
})

describe('invoice print page and download action', () => {
  const print = read('app/pages/subscription/invoices/print/[id].vue')
  it('gates the print page and the print button on billing.read', () => {
    expect(print).toContain("can('billing.read')")
    expect(print).toMatch(/<SharedForbiddenState v-if="!allowed"/)
    expect(print).toMatch(/<UButton v-if="allowed"[^>]*invoice-print-action/)
  })
  it('offers the download only to a reader of the invoice, with an accessible name', () => {
    const page = read('app/pages/subscription/invoices/[id].vue')
    const forbidden = page.indexOf('<SharedForbiddenState v-if="!allowed"')
    const action = page.indexOf('data-testid="invoice-download"')
    expect(forbidden).toBeGreaterThan(-1)
    expect(action).toBeGreaterThan(forbidden)
    expect(page).toMatch(/invoice-download|:label="t\('subscription\.invoices\.print\.download'\)"/)
    expect(page).toContain(":label=\"t('subscription.invoices.print.download')\"")
  })
})

describe('invoice list download action', () => {
  const list = read('app/pages/subscription/invoices/index.vue')
  it('offers each row a download icon button with an accessible name, in the table and the stacked row', () => {
    expect(list.match(/data-testid="invoice-row-download"/g)).toHaveLength(2)
    expect(list.match(/:aria-label="printLabel\(inv\)"/g)).toHaveLength(2)
    expect(list).toContain("t('subscription.invoices.print.rowAction'")
    expect(list).toContain('/subscription/invoices/print/')
  })
  it('stays behind the billing.read gate of the list', () => {
    expect(list).toContain("can('billing.read')")
    expect(list).toMatch(/<SharedListCard v-if="allowed">/)
  })
})
