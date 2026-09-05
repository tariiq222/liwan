import { BrandingPatchSchema } from '../branding'

describe('BrandingPatchSchema', () => {
  it('accepts valid partial patches and trims names', () => {
    expect(BrandingPatchSchema.parse({ name: '  Erada  ' })).toEqual({ name: 'Erada' })
    expect(BrandingPatchSchema.parse({ primary_color: '#0055ff' })).toEqual({ primary_color: '#0055ff' })
    expect(BrandingPatchSchema.parse({ logo: 'aGVsbG8=' })).toEqual({ logo: 'aGVsbG8=' })
  })

  it('rejects empty, invalid, and extra patches', () => {
    expect(() => BrandingPatchSchema.parse({})).toThrow()
    expect(() => BrandingPatchSchema.parse({ name: '   ' })).toThrow()
    expect(() => BrandingPatchSchema.parse({ name: 'a'.repeat(101) })).toThrow()
    expect(() => BrandingPatchSchema.parse({ primary_color: 'blue' })).toThrow()
    expect(() => BrandingPatchSchema.parse({ logo: 'data:image/png;base64,aGVsbG8=' })).toThrow()
    expect(() => BrandingPatchSchema.parse({ extra: true })).toThrow()
  })
})
