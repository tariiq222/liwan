import { describe, expect, it } from 'vitest'
import { MAX_MONEY_AMOUNT, canonicalFromMinor, parseMoneyInput } from '../moneyInput'

describe('parseMoneyInput', () => {
  it('accepts Arabic-Indic digits and Arabic decimal/thousands marks without using float-string parsing', () => {
    expect(parseMoneyInput('١٢٫٥٠', 2)).toEqual({ ok: true, value: 12.5, minor: 1250n, canonical: '12.50' })
    expect(parseMoneyInput('١٬٠٠٠٫٥٠', 2)).toEqual({ ok: true, value: 1000.5, minor: 100050n, canonical: '1000.50' })
    expect(parseMoneyInput('١٢.٥', 2)).toEqual({ ok: true, value: 12.5, minor: 1250n, canonical: '12.50' })
  })

  it('accepts a comma decimal only when it cannot be thousands grouping', () => {
    expect(parseMoneyInput('12,50', 2)).toMatchObject({ ok: true, canonical: '12.50', minor: 1250n })
    expect(parseMoneyInput('1,000.50', 2)).toMatchObject({ ok: true, canonical: '1000.50', minor: 100050n })
    expect(parseMoneyInput('1,234', 2)).toMatchObject({ ok: true, canonical: '1234.00', minor: 123400n })
    expect(parseMoneyInput('1 234.56', 2)).toMatchObject({ ok: true, canonical: '1234.56' })
    expect(parseMoneyInput('1,234,56', 2)).toMatchObject({ ok: true, canonical: '1234.56' })
  })

  it('rejects malformed grouping instead of silently widening the amount', () => {
    expect(parseMoneyInput('1,2345', 2).ok).toBe(false)
    expect(parseMoneyInput('1,2345', 2)).not.toEqual(expect.objectContaining({ value: 12345 }))
    expect(parseMoneyInput('1,2,3', 2).ok).toBe(false)
    expect(parseMoneyInput('1,2,3', 2)).not.toEqual(expect.objectContaining({ value: 123 }))
    expect(parseMoneyInput('12 34', 2).ok).toBe(false)
    expect(parseMoneyInput('12 34', 2)).not.toEqual(expect.objectContaining({ value: 1234 }))
  })

  it('rejects mixed incompatible decimal conventions and ambiguous comma grouping', () => {
    expect(parseMoneyInput('1.234,56', 2).ok).toBe(false)
    expect(parseMoneyInput('1٫50.0', 2).ok).toBe(false)
    expect(parseMoneyInput('1,234', 3).ok).toBe(false)
    expect(parseMoneyInput('1,234,567', 3).ok).toBe(false)
    expect(parseMoneyInput('١٬٢٣٤٥', 2).ok).toBe(false)
  })

  it('keeps minor-unit arithmetic exact where binary floats are not', () => {
    const ten = parseMoneyInput('0.10', 2)
    const twenty = parseMoneyInput('0.20', 2)
    expect(ten.ok && twenty.ok).toBe(true)
    if (!ten.ok || !twenty.ok) return
    expect(canonicalFromMinor(ten.minor + twenty.minor, 2)).toBe('0.30')
    expect(ten.canonical).toBe('0.10')
    expect(String(0.1 + 0.2)).not.toBe('0.3')
  })

  it('rejects empty, negative, non-finite, scientific, boolean, excess precision and overflow values', () => {
    expect(parseMoneyInput('   ', 2)).toEqual({ ok: false, code: 'empty' })
    expect(parseMoneyInput('-1', 2)).toEqual({ ok: false, code: 'negative' })
    expect(parseMoneyInput('Infinity', 2)).toEqual({ ok: false, code: 'invalid' })
    expect(parseMoneyInput('1e2', 2)).toEqual({ ok: false, code: 'invalid' })
    expect(parseMoneyInput('1E+2', 2)).toEqual({ ok: false, code: 'invalid' })
    expect(parseMoneyInput('NaN', 2)).toEqual({ ok: false, code: 'invalid' })
    expect(parseMoneyInput('true', 2)).toEqual({ ok: false, code: 'invalid' })
    expect(parseMoneyInput('12.345', 2)).toEqual({ ok: false, code: 'precision' })
    expect(parseMoneyInput('12.50', 0)).toEqual({ ok: false, code: 'precision' })
    expect(parseMoneyInput('1000000000000.01', 2)).toEqual({ ok: false, code: 'too_large' })
    expect(parseMoneyInput(String(MAX_MONEY_AMOUNT), 2)).toMatchObject({ ok: true, canonical: '1000000000000.00' })
  })

  it('pads short fractions to the currency decimal places instead of leaving a float-string', () => {
    expect(parseMoneyInput('12', 2)).toMatchObject({ ok: true, canonical: '12.00', minor: 1200n })
    expect(parseMoneyInput('12.5', 3)).toMatchObject({ ok: true, canonical: '12.500', minor: 12500n })
  })
})
