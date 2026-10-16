import { describe, expect, it } from 'vitest'
import type { Invoice } from '@webvue/commercial-contracts'
import { formatSubscriptionMoney, subscriptionInvoiceView } from '../subscription'

const money = (minor: number) => ({ currency: 'SAR', exponent: 2, minor })
const t = (key: string) => `t:${key}`
const invoice = {
  lines: [
    { key: 'a', kind: 'base', timing: 'now', description: 'Base', quantity: 5, free_quantity: 2, unit_amount: money(100), amount: money(300), period_start: '2026-10-01', period_end: '2026-10-31', source_revision_id: 'r' },
    { key: 'b', kind: 'discount', timing: 'now', description: 'Discount', quantity: 1, unit_amount: money(-50), amount: money(-50), period_start: '2026-10-01', period_end: '2026-10-31', source_revision_id: 'r' },
  ],
  subtotal: money(250), tax: money(38), total: money(288),
} as unknown as Invoice

describe('subscriptionInvoiceView', () => {
  it('keeps the list rendering: quantity, free and paid counts, then the amount', () => {
    const view = subscriptionInvoiceView(invoice, t, 'ar')
    expect(view.notice).toBe('t:subscription.invoices.notOfficial')
    expect(view.lines[0]!.cells.map(c => [c.key, c.value])).toEqual([['quantity', '× 5'], ['free', '2'], ['paid', '5']])
    expect(view.lines[1]!.cells.map(c => c.key)).toEqual(['quantity'])
    expect(view.lines[1]!.amount).toBe(formatSubscriptionMoney(money(-50), 'ar'))
  })

  it('ends with subtotal, tax and total in that order', () => {
    expect(subscriptionInvoiceView(invoice, t, 'ar').totals.map(row => row.label)).toEqual([
      't:subscription.invoices.subtotal', 't:subscription.invoices.tax', 't:subscription.invoices.total',
    ])
  })
})
