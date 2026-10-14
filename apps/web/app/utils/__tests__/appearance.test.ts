import { describe, expect, it } from 'vitest'
import { appearanceFromWire, appearancePatchBody, htmlAttrsFor, normalizeAppearance, sameAppearance } from '../appearance'

describe('saved appearance preferences', () => {
  it.each([undefined, null, '', 'dark', [], 42])('uses safe defaults for malformed storage %j', (input) => {
    expect(normalizeAppearance(input)).toEqual({ mode: 'light', fontSize: 'small' })
  })

  it('keeps a valid preference when the other field is invalid', () => {
    expect(normalizeAppearance({ mode: 'dark', fontSize: 'huge' })).toEqual({ mode: 'dark', fontSize: 'small' })
    expect(normalizeAppearance({ mode: 'system', fontSize: 'large' })).toEqual({ mode: 'light', fontSize: 'large' })
  })

  it('treats a stored cream preference as light', () => {
    expect(normalizeAppearance({ mode: 'cream', fontSize: 'medium' })).toEqual({ mode: 'light', fontSize: 'medium' })
    expect(appearanceFromWire({ mode: 'cream', font_size: 'large' })).toEqual({ mode: 'light', fontSize: 'large' })
  })

  it.each(['small', 'medium', 'large'])('restores the chosen %s font with dark mode and drops unknown attributes', (fontSize) => {
    expect(normalizeAppearance({ mode: 'dark', fontSize, extra: 'ignored' })).toEqual({ mode: 'dark', fontSize })
  })
})

describe('document attributes for an appearance', () => {
  it.each([
    ['light', ''],
    ['dark', 'dark'],
  ] as const)('maps %s mode to the html class %j', (mode, expected) => {
    expect(htmlAttrsFor({ mode, fontSize: 'small' }).class).toBe(expected)
  })

  it('only emits light or dark html classes', () => {
    expect(htmlAttrsFor({ mode: 'light', fontSize: 'small' }).class).toBe('')
    expect(htmlAttrsFor({ mode: 'dark', fontSize: 'small' }).class).toBe('dark')
  })

  it('carries font size, lang and dir through unchanged', () => {
    expect(htmlAttrsFor({ mode: 'dark', fontSize: 'large', lang: 'ar-SA', dir: 'rtl' })).toEqual({
      class: 'dark',
      'data-font-size': 'large',
      lang: 'ar-SA',
      dir: 'rtl',
    })
  })

  it.each(['rtl', 'ltr', 'auto'] as const)('keeps the valid direction %j', (dir) => {
    expect(htmlAttrsFor({ mode: 'light', fontSize: 'small', dir }).dir).toBe(dir)
  })

  it('drops a direction the document cannot use instead of writing it out', () => {
    expect(htmlAttrsFor({ mode: 'light', fontSize: 'small', dir: 'sideways' }).dir).toBeUndefined()
    expect(htmlAttrsFor({ mode: 'light', fontSize: 'small', dir: '' }).dir).toBeUndefined()
    expect(htmlAttrsFor({ mode: 'light', fontSize: 'small' }).dir).toBeUndefined()
  })
})

describe('per-user appearance on the wire', () => {
  it('maps the server copy to the client preference and falls back to defaults', () => {
    expect(appearanceFromWire({ mode: 'dark', font_size: 'large' })).toEqual({ mode: 'dark', fontSize: 'large' })
    expect(appearanceFromWire(null)).toEqual({ mode: 'light', fontSize: 'small' })
    expect(appearanceFromWire(undefined)).toEqual({ mode: 'light', fontSize: 'small' })
  })
  it('sends only the changed key with its wire name', () => {
    expect(appearancePatchBody({ mode: 'dark' })).toEqual({ mode: 'dark' })
    expect(appearancePatchBody({ fontSize: 'medium' })).toEqual({ font_size: 'medium' })
    expect(appearancePatchBody({})).toEqual({})
  })
  it('compares preferences by value', () => {
    expect(sameAppearance({ mode: 'dark', fontSize: 'small' }, { mode: 'dark', fontSize: 'small' })).toBe(true)
    expect(sameAppearance({ mode: 'dark', fontSize: 'small' }, { mode: 'dark', fontSize: 'large' })).toBe(false)
  })
})
