import { describe, expect, it } from 'vitest'
import { classifyDecline } from '../commercial/payment-decline.js'

describe('classifyDecline by gateway response code', () => {
  it.each([
    ['lost, stolen, retained or fraud-flagged', ['04', '07', '33', '34', '36', '41', '43', '59'], 'hard'],
    ['expired card, invalid card details', ['14', '54'], 'hard'],
    ['account restricted or not permitted', ['57', '62'], 'hard'],
    ['insufficient funds and limits exceeded', ['51', '61', '65'], 'soft'],
    ['issuer or system unavailable, timeout', ['68', '91', '96'], 'soft'],
    ['do not honour', ['05'], 'soft'],
    ['duplicate transaction: look it up, never retry blindly', ['94'], 'duplicate'],
  ] as const)('%s', (_category, codes, kind) => {
    for (const code of codes) expect(classifyDecline({ code }), code).toBe(kind)
  })

  it('lets the code win over the message in both directions', () => {
    expect(classifyDecline({ code: '51', message: 'DECLINED: LOST CARD' })).toBe('soft')
    expect(classifyDecline({ code: '41', message: 'INSUFFICIENT FUNDS' })).toBe('hard')
    expect(classifyDecline({ code: '94', message: 'DECLINED' })).toBe('duplicate')
  })

  it('falls back to the message for a code that is unknown, empty or missing, and to soft when nothing says otherwise', () => {
    expect(classifyDecline({ code: '99', message: 'DECLINED: STOLEN CARD' })).toBe('hard')
    expect(classifyDecline({ code: '', message: 'DECLINED: EXPIRED CARD' })).toBe('hard')
    expect(classifyDecline({ code: null, message: 'DECLINED: LOST CARD' })).toBe('hard')
    expect(classifyDecline({ code: '99', message: 'INSUFFICIENT FUNDS' })).toBe('soft')
    expect(classifyDecline({ code: '99' })).toBe('soft')
    expect(classifyDecline({})).toBe('soft')
  })
})
