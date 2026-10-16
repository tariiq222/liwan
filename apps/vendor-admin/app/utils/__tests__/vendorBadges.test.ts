import { describe, expect, it } from 'vitest'
import { customerDisplayBadge, operationStatusBadge, paymentAttemptBadge } from '../vendorBadges'

describe('vendor badge maps', () => {
  it('maps customer display states, operation statuses and payment attempts', () => {
    expect(customerDisplayBadge('failed').tone).toBe('destructive')
    expect(customerDisplayBadge('awaiting_payment')).toEqual({ tone: 'warning', labelKey: 'vendor.customers.display.awaiting_payment' })
    expect(operationStatusBadge('needs_intervention').tone).toBe('warning')
    expect(operationStatusBadge('verified').tone).toBe('success')
    expect(paymentAttemptBadge('canceled').tone).toBe('destructive')
    expect(paymentAttemptBadge('pending')).toEqual({ tone: 'info', labelKey: 'vendor.invoices.attemptStatus.pending' })
  })
  it('shows an unknown value as a neutral badge with no key, never throwing', () => {
    expect(operationStatusBadge('newer')).toEqual({ tone: 'neutral', labelKey: '' })
  })
})
