import { describe, expect, it } from 'vitest'
import { canReach } from '../../utils/accessPolicy'
import { canOfferPaymentLink, paymentLinkErrorKey, paymentLinkUrl, type PaymentLinkInvoice } from '../paymentLinks'

const owing: PaymentLinkInvoice = { id: 2, move_type: 'out_invoice', state: 'posted', payment_state: 'not_paid', amount_residual: 1380 }

describe('canOfferPaymentLink', () => {
  it('is offered for a posted customer invoice with an amount still owing, paid in part or not at all', () => {
    expect(canOfferPaymentLink(owing)).toBe(true)
    expect(canOfferPaymentLink({ ...owing, payment_state: 'partial', amount_residual: 300 })).toBe(true)
  })

  it.each([
    ['a draft', { state: 'draft' }],
    ['a cancelled document', { state: 'cancel' }],
    ['a paid invoice', { payment_state: 'paid', amount_residual: 0 }],
    ['an invoice with nothing left to pay', { amount_residual: 0 }],
    ['a credit note', { move_type: 'out_refund' }],
    ['a vendor bill', { move_type: 'in_invoice' }],
  ] as const)('is not offered for %s', (_name, change) => {
    expect(canOfferPaymentLink({ ...owing, ...change })).toBe(false)
  })

  it('is not offered while the invoice is not loaded', () => {
    expect(canOfferPaymentLink(undefined)).toBe(false)
    expect(canOfferPaymentLink(null)).toBe(false)
  })
})

describe('paymentLinkUrl', () => {
  it('puts the link\'s path on the origin the staff member is browsing', () => {
    expect(paymentLinkUrl('https://acme.webvue.example', '/pay/invoice/2?access_token=tok-2'))
      .toBe('https://acme.webvue.example/pay/invoice/2?access_token=tok-2')
  })
})

describe('paymentLinkErrorKey', () => {
  it('words the two refusals a staff member can act on', () => {
    expect(paymentLinkErrorKey({ code: 'not_payable' })).toBe('payments.link.errors.notPayable')
    expect(paymentLinkErrorKey({ code: 'no_gateway' })).toBe('payments.link.errors.noGateway')
  })

  it('leaves every other failure to the API\'s own text', () => {
    expect(paymentLinkErrorKey({ code: 'invalid' })).toBeNull()
    expect(paymentLinkErrorKey({ code: 'forbidden' })).toBeNull()
    expect(paymentLinkErrorKey(new Error('offline'))).toBeNull()
  })
})

// `useAccess().can` is `canReach` on the signed-in identity: the capability and, at the write level, the payments feature.
describe('the payment link capability gate', () => {
  const identity = (features: string[], capabilities = ['payments.links.manage']) => ({
    capabilities,
    platform: { readable_features: ['payments.enabled', ...features], writable_features: features },
  })

  it('opens for a holder of payments.links.manage while the payments feature is writable', () => {
    expect(canReach(identity(['payments.enabled']), 'payments.links.manage')).toBe(true)
  })

  it('stays closed without the capability', () => {
    expect(canReach(identity(['payments.enabled'], ['payments.providers.manage']), 'payments.links.manage')).toBe(false)
  })

  it('stays closed when the tenant has the payments feature off or read-only', () => {
    expect(canReach(identity([]), 'payments.links.manage')).toBe(false)
    expect(canReach({ capabilities: ['payments.links.manage'], platform: { readable_features: [], writable_features: [] } }, 'payments.links.manage')).toBe(false)
  })
})
