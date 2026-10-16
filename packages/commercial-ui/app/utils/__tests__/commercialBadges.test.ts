import { describe, expect, it } from 'vitest'
import { invoiceStatusBadge } from '../commercialBadges'

describe('invoiceStatusBadge', () => {
  it('maps every invoice status to a tone and the caller prefix', () => {
    expect(invoiceStatusBadge('paid', 'vendor.invoices.status')).toEqual({ tone: 'success', labelKey: 'vendor.invoices.status.paid' })
    expect(invoiceStatusBadge('credit_pending', 'subscription.invoices.statuses')).toEqual({ tone: 'warning', labelKey: 'subscription.invoices.statuses.credit_pending' })
    expect(invoiceStatusBadge('draft', 'vendor.invoices.status').tone).toBe('neutral')
    expect(invoiceStatusBadge('issued', 'vendor.invoices.status').tone).toBe('info')
    expect(invoiceStatusBadge('void', 'vendor.invoices.status').tone).toBe('destructive')
  })
  it('shows an unknown status as a neutral badge with no key, never throwing', () => {
    expect(invoiceStatusBadge('newer', 'vendor.invoices.status')).toEqual({ tone: 'neutral', labelKey: '' })
  })
})
