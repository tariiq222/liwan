import { describe, expect, it } from 'vitest'
import { cardExpiryLabel, maskedCardNumber, savedCardState } from '../paymentMethod'

const card = { brand: 'visa', last_four: '4242', exp_month: 3, exp_year: 2028, status: 'active' }

describe('saved card display', () => {
  it('stays valid through the last day of the expiry month in Riyadh time', () => {
    // 2028-03-31 23:59 in Riyadh is 20:59 UTC; the card still works.
    expect(savedCardState(card, new Date('2028-03-31T20:59:00Z'))).toBe('active')
    // 2028-04-01 00:00 in Riyadh is 2028-03-31 21:00 UTC; the card is expired.
    expect(savedCardState(card, new Date('2028-03-31T21:00:00Z'))).toBe('expired')
  })
  it('rolls December over to January of the next year', () => {
    const december = { ...card, exp_month: 12, exp_year: 2026 }
    expect(savedCardState(december, new Date('2026-12-31T20:59:59Z'))).toBe('active')
    expect(savedCardState(december, new Date('2026-12-31T21:00:00Z'))).toBe('expired')
  })
  it('reports expired before inactive, and inactive for any non-active status', () => {
    const now = new Date('2027-01-01T00:00:00Z')
    expect(savedCardState(card, now)).toBe('active')
    expect(savedCardState({ ...card, status: 'inactive' }, now)).toBe('inactive')
    expect(savedCardState({ ...card, status: 'removed' }, now)).toBe('inactive')
    expect(savedCardState({ ...card, status: 'inactive' }, new Date('2028-06-01T00:00:00Z'))).toBe('expired')
  })
  it('formats the expiry as MM/YY and shows only the last four digits', () => {
    expect(cardExpiryLabel(card)).toBe('03/28')
    expect(cardExpiryLabel({ exp_month: 11, exp_year: 2101 })).toBe('11/01')
    expect(maskedCardNumber(card)).toBe('•••• 4242')
  })
})
