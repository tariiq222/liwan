import { describe, expect, it } from 'vitest'
import { customerDisplayBadge, invoiceStatusBadge, operationStatusBadge, paymentAttemptBadge } from '../commercialBadges'

describe('commercial badge maps', () => {
  it('maps every invoice status to a tone and the caller prefix', () => {
    expect(invoiceStatusBadge('paid', 'vendor.invoices.status')).toEqual({ tone: 'success', labelKey: 'vendor.invoices.status.paid' })
    expect(invoiceStatusBadge('credit_pending', 'subscription.invoices.statuses')).toEqual({ tone: 'warning', labelKey: 'subscription.invoices.statuses.credit_pending' })
    expect(invoiceStatusBadge('draft', 'vendor.invoices.status').tone).toBe('neutral')
    expect(invoiceStatusBadge('issued', 'vendor.invoices.status').tone).toBe('info')
    expect(invoiceStatusBadge('void', 'vendor.invoices.status').tone).toBe('destructive')
  })
  it('maps customer display states, operation statuses and payment attempts', () => {
    expect(customerDisplayBadge('failed').tone).toBe('destructive')
    expect(customerDisplayBadge('awaiting_payment')).toEqual({ tone: 'warning', labelKey: 'vendor.customers.display.awaiting_payment' })
    expect(operationStatusBadge('needs_intervention').tone).toBe('warning')
    expect(operationStatusBadge('verified').tone).toBe('success')
    expect(paymentAttemptBadge('canceled').tone).toBe('destructive')
    expect(paymentAttemptBadge('pending')).toEqual({ tone: 'info', labelKey: 'vendor.invoices.attemptStatus.pending' })
  })
  it('shows an unknown value as a neutral badge with no key, never throwing', () => {
    expect(invoiceStatusBadge('newer' as never, 'vendor.invoices.status')).toEqual({ tone: 'neutral', labelKey: '' })
    expect(operationStatusBadge('newer')).toEqual({ tone: 'neutral', labelKey: '' })
  })
})
