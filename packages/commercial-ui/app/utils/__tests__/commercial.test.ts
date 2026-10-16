import { describe, expect, it } from 'vitest'
import { cadenceLabel, formatMoney, quoteLinesByTiming } from '../commercial'

const t = (key: string, p?: Record<string, unknown>) => `${key}${p ? JSON.stringify(p) : ''}`

describe('formatMoney', () => {
  it('formats minor units in the locale with the money exponent', () => {
    expect(formatMoney({ currency: 'SAR', exponent: 2, minor: 150000 }, 'en')).toContain('1,500.00')
    expect(formatMoney({ currency: 'SAR', exponent: 2, minor: 150000 })).toContain('1,500.00')
  })
})

describe('cadenceLabel', () => {
  it('uses the one/many keys of the commercial namespace', () => {
    expect(cadenceLabel({ unit: 'month', count: 1 }, t)).toBe('commercial.pricing.cadence.month.one')
    expect(cadenceLabel({ unit: 'year', count: 2 }, t)).toBe('commercial.pricing.cadence.year.many{"count":2}')
  })
})

describe('quoteLinesByTiming', () => {
  it('keeps the lines of one timing', () => {
    const quote = { lines: [{ key: 'a', timing: 'now' }, { key: 'b', timing: 'renewal' }, { key: 'c', timing: 'now' }] } as never
    expect(quoteLinesByTiming(quote, 'now').map(l => l.key)).toEqual(['a', 'c'])
    expect(quoteLinesByTiming(quote, 'renewal').map(l => l.key)).toEqual(['b'])
  })
})
