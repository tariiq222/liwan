import { describe, expect, it } from 'vitest'
import { decodePayReturn, type PaymentOption } from '@webvue/contracts'
import {
  PAY_POLL_INTERVAL_MS,
  formatPayAmount,
  formatPayDate,
  gatewayUrl,
  isInvalidLink,
  optionKey,
  payLinkOf,
  payReturnCookie,
  payStatusView,
  pollDelay,
  redirectUrl,
  startBody,
  startErrorKey,
} from '../paymentPay'

const OPTION: PaymentOption = { provider_id: 7, provider: 'paymob', method_id: 12, method: 'mada', method_name: 'مدى' }
const LINK = { id: 42, token: 'abc_DEF-123' }

describe('payLinkOf', () => {
  it('reads the invoice id and token of a pay address', () => {
    expect(payLinkOf('42', 'abc_DEF-123')).toEqual(LINK)
  })

  it.each([
    ['a missing token', '42', undefined],
    ['a token given twice', '42', ['a', 'b']],
    ['an empty token', '42', ''],
    ['a token with other characters', '42', 'a b'],
    ['a token that is too long', '42', 'a'.repeat(129)],
    ['an id that is not a number', 'abc', 'tok'],
    ['an id of zero', '0', 'tok'],
    ['an id with a sign', '-4', 'tok'],
    ['an id with a leading zero', '04', 'tok'],
    ['an id given twice', ['1', '2'], 'tok'],
  ])('refuses %s', (_name, id, token) => {
    expect(payLinkOf(id, token)).toBeNull()
  })
})

describe('isInvalidLink', () => {
  it('is the 404 the server answers for any wrong id, wrong token or expired link', () => {
    expect(isInvalidLink({ status: 404, code: 'not_found' })).toBe(true)
  })

  it('is not any other failure', () => {
    expect(isInvalidLink({ status: 500, code: 'http_error' })).toBe(false)
    expect(isInvalidLink(new Error('network'))).toBe(false)
    expect(isInvalidLink(null)).toBe(false)
    expect(isInvalidLink(undefined)).toBe(false)
  })
})

describe('the start request', () => {
  it('identifies an option by provider and method together', () => {
    expect(optionKey(OPTION)).toBe('7:12')
    expect(optionKey({ ...OPTION, method_id: 11 })).not.toBe(optionKey(OPTION))
  })

  it('sends only the token and the chosen option; amount, currency and payer come from the invoice', () => {
    expect(startBody(LINK, OPTION)).toEqual({ access_token: 'abc_DEF-123', provider_id: 7, payment_method_id: 12 })
  })

  it('words the refusals the pay page knows and leaves the rest generic', () => {
    expect(startErrorKey({ code: 'not_payable' })).toBe('payments.pay.errors.notPayable')
    expect(startErrorKey({ code: 'payment_unavailable' })).toBe('payments.pay.errors.unavailable')
    expect(startErrorKey({ code: 'payment_in_progress' })).toBe('payments.pay.errors.inProgress')
    expect(startErrorKey({ code: 'invalid' })).toBeNull()
    expect(startErrorKey(new Error('offline'))).toBeNull()
  })
})

describe('payReturnCookie', () => {
  it('stores the invoice and token the return route decodes, on its path, for an hour', () => {
    const cookie = payReturnCookie(LINK, false)
    expect(cookie).toBe('webvue_pay_return=42.abc_DEF-123; Path=/payment; Max-Age=3600; SameSite=Lax')
    const value = cookie.split(';')[0]!.split('=')[1]
    expect(decodePayReturn(value)).toEqual({ invoiceId: 42, accessToken: 'abc_DEF-123' })
  })

  it('is Secure on https only', () => {
    expect(payReturnCookie(LINK, true)).toMatch(/; Secure$/)
    expect(payReturnCookie(LINK, false)).not.toContain('Secure')
  })
})

describe('the gateway redirect', () => {
  const redirect = (url: string, fields: Record<string, string> = {}) => ({ method: 'get' as const, url, fields })

  it('opens a get redirect at its address with the fields as query', () => {
    expect(redirectUrl(redirect('https://pay.example/checkout', { payment_token: 'pt 1', ref: 'a&b' })))
      .toBe('https://pay.example/checkout?payment_token=pt+1&ref=a%26b')
  })

  it('keeps the query the address already has, and lets a field replace a parameter of the same name', () => {
    expect(redirectUrl(redirect('https://pay.example/checkout?lang=ar&token=old', { token: 'new' })))
      .toBe('https://pay.example/checkout?lang=ar&token=new')
  })

  it('opens an address with no fields as it is', () => {
    expect(redirectUrl(redirect('https://pay.example/checkout'))).toBe('https://pay.example/checkout')
  })

  it.each(['javascript:alert(1)', 'data:text/html,x', 'ftp://pay.example/x'])('never sends the browser to %s', (url) => {
    expect(() => gatewayUrl(redirect(url))).toThrow('web address')
    expect(() => redirectUrl(redirect(url))).toThrow('web address')
  })
})

describe('the status page window', () => {
  it('re-reads an invoice that is still waiting for its payment while the window is open', () => {
    expect(pollDelay('payable', true)).toBe(PAY_POLL_INTERVAL_MS)
    expect(pollDelay('processing', true)).toBe(PAY_POLL_INTERVAL_MS)
    expect(PAY_POLL_INTERVAL_MS).toBe(3000)
  })

  it('stops when the window closes, and never re-reads a settled or unreadable invoice', () => {
    expect(pollDelay('payable', false)).toBe(false)
    expect(pollDelay('processing', false)).toBe(false)
    expect(pollDelay('paid', true)).toBe(false)
    expect(pollDelay('not_payable', true)).toBe(false)
    expect(pollDelay(undefined, true)).toBe(false)
  })

  it('tells the payer paid, processing or not payable as they are', () => {
    expect(payStatusView('paid', true)).toBe('paid')
    expect(payStatusView('paid', false)).toBe('paid')
    expect(payStatusView('processing', true)).toBe('processing')
    expect(payStatusView('processing', false)).toBe('processing')
    expect(payStatusView('not_payable', true)).toBe('notPayable')
  })

  it('treats a payable invoice as still being confirmed until the window closes, then as not paid', () => {
    expect(payStatusView('payable', true)).toBe('confirming')
    expect(payStatusView('payable', false)).toBe('notPaid')
  })
})

describe('formatPayAmount', () => {
  it('writes Latin digits with grouping and the currency\'s own decimals, without the currency code', () => {
    expect(formatPayAmount(1380, 'SAR')).toBe('1,380.00')
    expect(formatPayAmount(16905.5, 'SAR')).toBe('16,905.50')
    expect(formatPayAmount(12.345, 'OMR')).toBe('12.345')
    expect(formatPayAmount(5000, 'JPY')).toBe('5,000')
  })
})

describe('formatPayDate', () => {
  it('writes a long Gregorian date with Latin digits in the UI language, whatever the browser time zone', () => {
    expect(formatPayDate('2026-10-31', 'en')).toBe('October 31, 2026')
    expect(formatPayDate('2026-10-31', 'ar')).toMatch(/^31 .+ 2026$/)
    expect(formatPayDate('2026-10-31T23:30:00', 'en')).toBe('October 31, 2026')
  })

  it('shows the server text unchanged when it is not a date', () => {
    expect(formatPayDate('soon', 'en')).toBe('soon')
    expect(formatPayDate('2026-13-45', 'en')).toBe('2026-13-45')
  })
})
