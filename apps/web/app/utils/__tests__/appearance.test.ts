import { describe, expect, it } from 'vitest'
import { appearanceFromWire, appearancePatchBody, htmlAttrsFor, normalizeAppearance, sameAppearance } from '../appearance'

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

describe('per-user appearance on the wire', () => {
  it('maps the server copy to the client preference and falls back to defaults', () => {
    expect(appearanceFromWire({ mode: 'dark', font_size: 'large' })).toEqual({ mode: 'dark', fontSize: 'large' })
    expect(appearanceFromWire(null)).toEqual({ mode: 'light', fontSize: 'small' })
    expect(appearanceFromWire(undefined)).toEqual({ mode: 'light', fontSize: 'small' })
  })
  it('sends only the changed key with its wire name', () => {
    expect(appearancePatchBody({ mode: 'cream' })).toEqual({ mode: 'cream' })
    expect(appearancePatchBody({ fontSize: 'medium' })).toEqual({ font_size: 'medium' })
    expect(appearancePatchBody({})).toEqual({})
  })
  it('compares preferences by value', () => {
    expect(sameAppearance({ mode: 'dark', fontSize: 'small' }, { mode: 'dark', fontSize: 'small' })).toBe(true)
    expect(sameAppearance({ mode: 'dark', fontSize: 'small' }, { mode: 'dark', fontSize: 'large' })).toBe(false)
  })
})
