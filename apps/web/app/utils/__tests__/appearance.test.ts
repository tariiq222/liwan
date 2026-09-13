import { describe, expect, it } from 'vitest'
import { htmlAttrsFor, normalizeAppearance } from '../appearance'

describe('saved appearance preferences', () => {
  it.each([undefined, null, '', 'dark', [], 42])('uses safe defaults for malformed storage %j', (input) => {
    expect(normalizeAppearance(input)).toEqual({ mode: 'light', fontSize: 'small' })
  })

  it('keeps a valid preference when the other field is invalid', () => {
    expect(normalizeAppearance({ mode: 'dark', fontSize: 'huge' })).toEqual({ mode: 'dark', fontSize: 'small' })
    expect(normalizeAppearance({ mode: 'cream', fontSize: 'medium' })).toEqual({ mode: 'cream', fontSize: 'medium' })
    expect(normalizeAppearance({ mode: 'system', fontSize: 'large' })).toEqual({ mode: 'light', fontSize: 'large' })
  })

  it.each(['small', 'medium', 'large'])('restores the chosen %s font with dark mode and drops unknown attributes', (fontSize) => {
    expect(normalizeAppearance({ mode: 'dark', fontSize, extra: 'ignored' })).toEqual({ mode: 'dark', fontSize })
  })
})

describe('document attributes for an appearance', () => {
  it.each([
    ['light', ''],
    ['dark', 'dark'],
    ['cream', 'cream'],
  ] as const)('maps %s mode to the html class %j', (mode, expected) => {
    expect(htmlAttrsFor({ mode, fontSize: 'small' }).class).toBe(expected)
  })

  it('carries font size, lang and dir through unchanged', () => {
    expect(htmlAttrsFor({ mode: 'dark', fontSize: 'large', lang: 'ar-SA', dir: 'rtl' })).toEqual({
      class: 'dark',
      'data-font-size': 'large',
      lang: 'ar-SA',
      dir: 'rtl',
    })
  })
})
