import { describe, expect, it } from 'vitest'
import { formatPercent } from '../formatNumber'

describe('formatPercent', () => {
  it('uses Intl without a space or bidi marks before the sign', () => {
    expect(formatPercent(16.7)).toBe('16.7%')
    expect(formatPercent(100)).toBe('100%')
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(null)).toBe('')
  })
})
