import { describe, expect, it } from 'vitest'
import type { CustomerInvoice, Invoice } from '@liwan/commercial-contracts'
import { formatCommercialMoney } from '../commercial'
import { invoiceCreditSummary, invoiceDay, invoiceLinesView, sellerLegalName } from '../invoiceDocument'

const money = (minor: number) => ({ currency: 'SAR', exponent: 2, minor })
const t = (key: string) => `t:${key}`
const invoice = {
  lines: [
    { key: 'a', kind: 'base', timing: 'now', description: 'Base', quantity: 5, free_quantity: 2, unit_amount: money(100), amount: money(300), period_start: '2026-10-01', period_end: '2026-10-31', source_revision_id: 'r' },
    { key: 'b', kind: 'discount', timing: 'now', description: 'Discount', quantity: 1, unit_amount: money(-50), amount: money(-50), period_start: '2026-10-01', period_end: '2026-10-31', source_revision_id: 'r' },
  ],
  subtotal: money(250), tax: money(38), total: money(288),
} as unknown as Invoice

describe('invoiceLinesView', () => {
  it('keeps the list rendering: quantity, free and paid counts, then the amount', () => {
    const view = invoiceLinesView(invoice, t, 'ar')
    expect(view.notice).toBe('t:commercial.invoice.notOfficial')
    expect(view.lines[0]!.cells.map(c => [c.key, c.value])).toEqual([['quantity', '× 5'], ['free', '2'], ['paid', '5']])
    expect(view.lines[1]!.cells.map(c => c.key)).toEqual(['quantity'])
    expect(view.lines[1]!.amount).toBe(formatCommercialMoney(money(-50), 'ar'))
  })

  it('labels metered invoice lines from the locale, never the server description', () => {
    const metered = { ...invoice, lines: [
      ...invoice.lines,
      { key: 'users', kind: 'users', timing: 'now', description: 'Users', quantity: 7, unit_amount: money(2500), amount: money(17500), period_start: '2026-10-01', period_end: '2026-10-31', source_revision_id: 'r' },
      { key: 'storage', kind: 'storage', timing: 'now', description: 'Storage', quantity: 15, unit_amount: money(500), amount: money(7500), period_start: '2026-10-01', period_end: '2026-10-31', source_revision_id: 'r' },
    ] } as unknown as Invoice
    const view = invoiceLinesView(metered, t, 'ar')
    expect(view.lines.find(l => l.id === 'users')!.description).toBe('t:commercial.invoice.users')
    expect(view.lines.find(l => l.id === 'storage')!.description).toBe('t:commercial.invoice.storage')
  })

  it('ends with subtotal and total when Liwan charged no tax, and names the tax row only when it did', () => {
    // Liwan is not VAT-registered (owner decision 2026-11-06): its own invoices carry no tax row.
    expect(invoiceLinesView({ ...invoice, tax: money(0), total: money(250), tax_label: null }, t, 'ar').totals.map(row => row.label)).toEqual([
      't:commercial.invoice.subtotal', 't:commercial.invoice.total',
    ])
    expect(invoiceLinesView({ ...invoice, tax_label: 'VAT 15% exclusive' }, t, 'ar').totals.map(row => row.label)).toEqual([
      't:commercial.invoice.subtotal', 't:commercial.invoice.tax', 't:commercial.invoice.total',
    ])
  })
})

describe('invoiceDay', () => {
  it('is the Riyadh calendar day of an instant, and a date-only value as it is', () => {
    expect(invoiceDay('2026-10-01T22:30:00Z')).toBe('2026-10-02')
    expect(invoiceDay('2026-10-02T01:00:00+03:00')).toBe('2026-10-02')
    expect(invoiceDay('2026-10-16')).toBe('2026-10-16')
    expect(invoiceDay(null)).toBeNull()
  })
})

describe('credit summary', () => {
  const note = (status: 'pending' | 'applied' | 'refunded', amount: number) => ({ id: 'n1', amount: money(amount), cause: 'vendor_refund', status, created_at: '2026-10-05T08:00:00Z', refunded_at: null, refund_reference: null })
  const full = (extra: Record<string, unknown>) => ({ status: 'paid', total: money(26000), credit_notes: [], ...extra }) as unknown as CustomerInvoice

  it('nets the credit off the total and never goes below zero', () => {
    expect(invoiceCreditSummary(full({ credit_notes: [note('refunded', 10000)] }))).toMatchObject({ credited: money(10000), net: money(16000), state: 'paid' })
    expect(invoiceCreditSummary(full({ credit_notes: [note('refunded', 99999)] }))).toMatchObject({ net: money(0), state: 'refunded' })
  })

  it('stays credit pending while a covering note is not refunded', () => {
    expect(invoiceCreditSummary(full({ credit_notes: [note('pending', 26000)] })).state).toBe('credit_pending')
  })
})

describe('sellerLegalName', () => {
  const seller = { legal_name_ar: 'شركة ليوان المحدودة', legal_name_en: 'Liwan Co.' } as NonNullable<CustomerInvoice['seller']>
  it('names the seller in the reader\'s language and falls back to the other one', () => {
    expect(sellerLegalName(seller, 'en')).toBe('Liwan Co.')
    expect(sellerLegalName(seller, 'ar')).toBe('شركة ليوان المحدودة')
    expect(sellerLegalName({ ...seller, legal_name_en: '' }, 'en')).toBe('شركة ليوان المحدودة')
  })
})
