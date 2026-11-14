import { describe, expect, it } from 'vitest'
import { autoRenewRequestSchema, cardExpired, cardLastValidDate } from '../commercial/index.js'

describe('card expiry', () => {
  const card = { exp_month: 3, exp_year: 2028 }
  it('is valid through the last day of the expiry month in Riyadh time', () => {
    expect(cardLastValidDate(card)).toBe('2028-03-31')
    expect(cardLastValidDate({ exp_month: 2, exp_year: 2028 })).toBe('2028-02-29')
    expect(cardLastValidDate({ exp_month: 12, exp_year: 2027 })).toBe('2027-12-31')
    // 2028-03-31 20:59:59Z is still 23:59:59 in Riyadh; one second later it is April there.
    expect(cardExpired(card, new Date('2028-03-31T20:59:59Z'))).toBe(false)
    expect(cardExpired(card, new Date('2028-03-31T21:00:00Z'))).toBe(true)
  })
})

describe('auto-renew request', () => {
  it('needs the consent text version only to switch on', () => {
    expect(autoRenewRequestSchema.safeParse({ enabled: true }).success).toBe(false)
    expect(autoRenewRequestSchema.safeParse({ enabled: true, consent_text_version: 'auto-renew-2026-11' }).success).toBe(true)
    expect(autoRenewRequestSchema.safeParse({ enabled: false }).success).toBe(true)
    expect(autoRenewRequestSchema.safeParse({ enabled: true, consent_text_version: 'v1', consent: true }).success).toBe(false)
  })
})
