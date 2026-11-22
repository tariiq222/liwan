import { describe, expect, it } from 'vitest'
import { normalizeOneTimeCode } from '../oneTimeCode'
import { latinDigits } from '../digits'

describe('latinDigits', () => {
  it('turns Arabic-Indic digits into Latin ones and leaves the rest', () => {
    expect(latinDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789')
    expect(latinDigits('٣ ab 4')).toBe('3 ab 4')
  })
  it('turns Extended Arabic-Indic digits (Persian and Urdu keyboards) into Latin ones too', () => {
    expect(latinDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789')
    expect(latinDigits('۱۲ ٣٤')).toBe('12 34')
  })
})

describe('normalizeOneTimeCode', () => {
  it('reads Arabic-Indic digits and drops the spaces of a pasted code', () => {
    expect(normalizeOneTimeCode('١٢٣ ٤٥٦')).toBe('123456')
    expect(normalizeOneTimeCode('۱۲۳ ۴۵۶')).toBe('123456')
    expect(normalizeOneTimeCode(' 123 456 ')).toBe('123456')
    expect(normalizeOneTimeCode('123 456')).toBe('123456')
    expect(normalizeOneTimeCode('‎123456‏')).toBe('123456')
  })
  it('keeps what is not a digit, so the server still refuses it', () => {
    expect(normalizeOneTimeCode('12a456')).toBe('12a456')
  })
})
