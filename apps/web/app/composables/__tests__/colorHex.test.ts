import { describe, expect, it } from 'vitest'
import { buildBrandingPatch, normalizeHex } from '../colorHex'

describe('normalizeHex', () => {
  it('normalizes a valid six-digit colour for the API contract', () => {
    expect(normalizeHex('  #A1B2C3 ')).toBe('#a1b2c3')
    expect(normalizeHex('0055FF')).toBe('#0055ff')
  })

  it('rejects shorthand, malformed, and empty colours', () => {
    expect(normalizeHex('#abc')).toBeNull()
    expect(normalizeHex('#12345g')).toBeNull()
    expect(normalizeHex('')).toBeNull()
  })
})

describe('buildBrandingPatch', () => {
  it('normalizes colour and never forwards stale identity or secondary fields', () => {
    const staleDraft = { name: 'Changed', logo: 'cG5n', primaryColor: '#ABCDEF', secondaryColor: '#d14a00' }
    expect(buildBrandingPatch(staleDraft)).toEqual({ primary_color: '#abcdef' })
  })

  it('rejects invalid colours', () => {
    expect(buildBrandingPatch({ primaryColor: '#123' })).toBeNull()
  })
})
