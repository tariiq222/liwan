import { describe, expect, it } from 'vitest'
import type { SalesPublicQuotation } from '@liwan/contracts'
import { ApiError } from '../../useApi'
import { decodedBytes, isInvalidQuoteLink, pngBase64, quoteAnswerErrorKey, quoteChanged, quoteLinkOf, quoteNeedsSignature, quotePath, quotePaymentShown, quotePdfHref, quoteView, signatureFits } from '../salesQuote'

const QUOTE: SalesPublicQuotation = {
  id: 7, number: 'S00007', state: 'sent', expired: false, company_name: 'Liwan', customer_name: 'Acme', date: '2026-11-14T08:00:00Z', validity_date: '2026-12-14', terms: '',
  currency: { id: 2, name: 'SAR', symbol: 'ر.س' }, amount_untaxed: 0, amount_tax: 0, amount_total: 0, lines: [],
  answer_mode: 'accept', signature_methods: 'draw_or_type', answer: null, answered_at: null, signed_by: null, can_accept: true, can_decline: true,
}

describe('quoteLinkOf', () => {
  it('reads the quotation and token of an address of the shape the server issues', () => {
    expect(quoteLinkOf('42', 'tok-42_A')).toEqual({ id: 42, token: 'tok-42_A' })
    expect(quoteLinkOf('42', 'x'.repeat(128))).not.toBeNull()
  })

  it('refuses a missing, malformed or oversized id or token, so no request is made', () => {
    expect(quoteLinkOf('42', undefined)).toBeNull()
    expect(quoteLinkOf('42', ['a', 'b'])).toBeNull()
    expect(quoteLinkOf('42', '')).toBeNull()
    expect(quoteLinkOf('42', 'a b')).toBeNull()
    expect(quoteLinkOf('42', '../x')).toBeNull()
    expect(quoteLinkOf('42', 'x'.repeat(129))).toBeNull()
    expect(quoteLinkOf('0', 'tok')).toBeNull()
    expect(quoteLinkOf('01', 'tok')).toBeNull()
    expect(quoteLinkOf('4x', 'tok')).toBeNull()
    expect(quoteLinkOf('1'.repeat(13), 'tok')).toBeNull()
    expect(quoteLinkOf(['4'], 'tok')).toBeNull()
  })
})

describe('quote routes', () => {
  const link = { id: 42, token: 'tok 42/&' }

  it('names each public route of the quotation and encodes the token of the download', () => {
    expect(quotePath(link)).toBe('/api/v1/public/sales/quotations/42')
    expect(quotePath(link, '/accept')).toBe('/api/v1/public/sales/quotations/42/accept')
    expect(quotePdfHref(link)).toBe('/api/v1/public/sales/quotations/42/pdf?access_token=tok%2042%2F%26')
  })
})

describe('refusals', () => {
  it('treats only a 404 as an invalid link', () => {
    expect(isInvalidQuoteLink(new ApiError(404, 'not_found', 'no'))).toBe(true)
    expect(isInvalidQuoteLink(new ApiError(500, 'unavailable', 'down'))).toBe(false)
    expect(isInvalidQuoteLink(new Error('offline'))).toBe(false)
    expect(isInvalidQuoteLink(null)).toBe(false)
  })

  it('words each refused answer and says the rest generically', () => {
    const code = (value: string, status = 422) => quoteAnswerErrorKey(new ApiError(status, value, 'x'))
    expect(code('answer_not_allowed')).toBe('sales.quote.errors.answerNotAllowed')
    expect(code('already_answered')).toBe('sales.quote.errors.alreadyAnswered')
    expect(code('quotation_expired')).toBe('sales.quote.errors.expired')
    expect(code('signature_required')).toBe('sales.quote.errors.signatureRequired')
    expect(code('signature_invalid')).toBe('sales.quote.errors.signatureInvalid')
    expect(code('branch_read_only', 403)).toBe('sales.quote.errors.readOnly')
    expect(code('tenant_read_only', 403)).toBe('sales.quote.errors.readOnly')
    expect(code('tenant_suspended', 403)).toBe('sales.quote.errors.readOnly')
    expect(code('payload_too_large', 413)).toBe('sales.quote.signatureTooLarge')
    expect(code('rate_limited', 429)).toBe('sales.quote.errors.rateLimited')
    expect(code('toString')).toBe('sales.quote.errors.failed')
    expect(quoteAnswerErrorKey(new Error('offline'))).toBe('sales.quote.errors.failed')
    expect(quoteAnswerErrorKey(null)).toBe('sales.quote.errors.failed')
  })

  it('reads the quotation again after a 422 or a withdrawn link, not after a read-only refusal or an outage', () => {
    expect(quoteChanged(new ApiError(422, 'already_answered', 'x'))).toBe(true)
    expect(quoteChanged(new ApiError(404, 'not_found', 'x'))).toBe(true)
    expect(quoteChanged(new ApiError(403, 'branch_read_only', 'x'))).toBe(false)
    expect(quoteChanged(new ApiError(500, 'unavailable', 'x'))).toBe(false)
  })
})

describe('quoteView', () => {
  const view = (fields: Partial<SalesPublicQuotation>) => quoteView({ ...QUOTE, ...fields })

  it('is open while the customer may still answer', () => {
    expect(view({})).toBe('open')
    expect(view({ can_decline: false })).toBe('open')
    expect(view({ answer_mode: 'accept_and_sign', can_accept: true })).toBe('open')
  })

  it('is open while a quotation that cannot be answered online can still be paid', () => {
    const payment = { percent: 100, amount: 90, currency: 'SAR', pay_url: '/pay/order/7?access_token=tok', state: 'payable' } as const
    expect(view({ answer_mode: 'none', can_accept: false, can_decline: false, payment })).toBe('open')
    expect(view({ answer_mode: 'none', can_accept: false, can_decline: false, payment: { ...payment, state: 'paid', pay_url: null } })).toBe('notOffered')
    expect(view({ answer_mode: 'none', can_accept: false, can_decline: false, payment: null })).toBe('notOffered')
    // Paying does not hide an answer that was given.
    expect(view({ answer: 'accepted', can_accept: false, can_decline: false, payment })).toBe('accepted')
  })

  it('tells what became of a quotation that is not open', () => {
    expect(view({ answer: 'accepted', can_accept: false, can_decline: false })).toBe('accepted')
    expect(view({ answer: 'accepted', state: 'confirmed', can_accept: false, can_decline: false })).toBe('accepted')
    expect(view({ answer: 'declined', can_accept: false, can_decline: false })).toBe('declined')
    expect(view({ state: 'confirmed', can_accept: false, can_decline: false })).toBe('confirmed')
    expect(view({ state: 'cancelled' })).toBe('cancelled')
    expect(view({ expired: true, can_accept: false, can_decline: false })).toBe('expired')
    expect(view({ answer_mode: 'none', can_accept: false, can_decline: false })).toBe('notOffered')
  })

  it('puts a cancelled quotation before an answer and an answer before expiry', () => {
    expect(view({ state: 'cancelled', answer: 'accepted' })).toBe('cancelled')
    // The server cancels a quotation the customer declines: it still reads as their decline, not the sender's cancellation.
    expect(view({ state: 'cancelled', answer: 'declined', can_accept: false, can_decline: false })).toBe('declined')
    expect(view({ state: 'cancelled', answer: null, can_accept: false, can_decline: false })).toBe('cancelled')
    expect(view({ expired: true, answer: 'declined' })).toBe('declined')
  })
})

describe('signature size', () => {
  it('measures the decoded bytes of a base64 string, padding included', () => {
    expect(decodedBytes(btoa('a'.repeat(3)))).toBe(3)
    expect(decodedBytes(btoa('a'.repeat(4)))).toBe(4)
    expect(decodedBytes(btoa('a'.repeat(5)))).toBe(5)
    expect(decodedBytes('')).toBe(0)
  })

  it('accepts a signature up to 48 KB decoded and refuses a larger one', () => {
    expect(signatureFits(btoa('a'.repeat(48 * 1024)))).toBe(true)
    expect(signatureFits(btoa('a'.repeat(48 * 1024 + 1)))).toBe(false)
  })

  it('strips the data URL prefix the server refuses', () => {
    expect(pngBase64('data:image/png;base64,iVBORw0KGgo=')).toBe('iVBORw0KGgo=')
  })
})

describe('quotePaymentShown', () => {
  const unavailable = { percent: 100, amount: 90, currency: 'SAR', pay_url: null, state: 'unavailable' } as const
  const shown = (patch: Partial<SalesPublicQuotation>) => quotePaymentShown({ ...QUOTE, payment: unavailable, ...patch })

  it('tells "payment is not available" only while the customer can still act on the quotation', () => {
    expect(shown({})).toBe(unavailable)
    expect(shown({ answer: 'accepted', can_accept: false, can_decline: false })).toBe(unavailable)
  })

  it('says nothing about it on a quotation that is confirmed without payment, declined, cancelled or expired', () => {
    expect(shown({ state: 'confirmed', can_accept: false, can_decline: false })).toBeNull()
    expect(shown({ answer: 'accepted', state: 'confirmed', can_accept: false, can_decline: false })).toBeNull()
    expect(shown({ state: 'cancelled', answer: 'declined', can_accept: false, can_decline: false })).toBeNull()
    expect(shown({ state: 'cancelled', can_accept: false, can_decline: false })).toBeNull()
    expect(shown({ expired: true, can_accept: false, can_decline: false })).toBeNull()
  })

  it('always reports the states that carry news, and nothing when there is no payment', () => {
    const paid = { ...unavailable, state: 'paid' } as const
    expect(shown({ payment: paid, state: 'confirmed', can_accept: false, can_decline: false })).toBe(paid)
    expect(shown({ payment: null })).toBeNull()
  })
})

describe('quoteNeedsSignature', () => {
  it('is true only while a signature is asked for and the customer has not answered', () => {
    expect(quoteNeedsSignature({ ...QUOTE, answer_mode: 'accept_and_sign' })).toBe(true)
    expect(quoteNeedsSignature({ ...QUOTE, answer_mode: 'accept_and_sign', answer: 'accepted' })).toBe(false)
    expect(quoteNeedsSignature({ ...QUOTE, answer_mode: 'accept' })).toBe(false)
    expect(quoteNeedsSignature({ ...QUOTE, answer_mode: 'none' })).toBe(false)
  })
})
