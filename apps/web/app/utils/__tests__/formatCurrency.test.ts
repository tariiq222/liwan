import { describe, expect, it } from 'vitest'
import { formatCurrency } from '../formatCurrency'

describe('formatCurrency', () => {
  it('formats an amount in its currency', () => {
    expect(formatCurrency(115, 'SAR', 'en')).toContain('115')
  })

  it('survives an unknown currency code', () => {
    expect(formatCurrency(5, 'ZZ', 'en')).toBe('5 ZZ')
  })
})
