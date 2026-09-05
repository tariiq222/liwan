import { describe, expect, it } from 'vitest'
import { buildBrandingPatch, normalizeHex } from '../colorHex'

describe('normalizeHex', () => {
  it('normalizes a valid six-digit color for the API contract', () => {
    expect(normalizeHex('  #A1B2C3 ')).toBe('#a1b2c3')
    expect(normalizeHex('0055FF')).toBe('#0055ff')
  })

  it('rejects shorthand, malformed, and non-string colors', () => {
    expect(normalizeHex('#abc')).toBeNull()
    expect(normalizeHex('#12345g')).toBeNull()
    expect(normalizeHex('')).toBeNull()
  })
})

describe('buildBrandingPatch', () => {
  it('trims the name, normalizes color, and omits an absent logo', () => {
    expect(buildBrandingPatch({ name: '  Nasq Co  ', primaryColor: '#ABCDEF' })).toEqual({
      name: 'Nasq Co',
      primary_color: '#abcdef',
    })
  })

  it('includes only raw base64 logo data', () => {
    expect(buildBrandingPatch({ name: 'Nasq', primaryColor: '#123456', logo: 'cG5n' })).toEqual({
      name: 'Nasq',
      primary_color: '#123456',
      logo: 'cG5n',
    })
    expect(buildBrandingPatch({
      name: 'Nasq',
      primaryColor: '#123456',
      logo: 'data:image/png;base64,cG5n',
    })).toBeNull()
  })

  it('rejects blank and overlong names or invalid colors', () => {
    expect(buildBrandingPatch({ name: '   ', primaryColor: '#123456' })).toBeNull()
    expect(buildBrandingPatch({ name: 'x'.repeat(101), primaryColor: '#123456' })).toBeNull()
    expect(buildBrandingPatch({ name: 'Nasq', primaryColor: '#123' })).toBeNull()
  })
})
