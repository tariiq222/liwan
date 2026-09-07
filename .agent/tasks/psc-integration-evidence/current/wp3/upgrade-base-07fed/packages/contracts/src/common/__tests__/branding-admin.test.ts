import { BrandingPatchSchema } from '../branding'

describe('BrandingPatchSchema', () => {
  it('accepts only a valid primary colour patch', () => {
    expect(BrandingPatchSchema.parse({ primary_color: '#0055ff' })).toEqual({ primary_color: '#0055ff' })
  })

  it('rejects empty, invalid, and extra patches', () => {
    expect(() => BrandingPatchSchema.parse({})).toThrow()
    expect(() => BrandingPatchSchema.parse({ primary_color: 'blue' })).toThrow()
    expect(() => BrandingPatchSchema.parse({ name: 'Changed' })).toThrow()
    expect(() => BrandingPatchSchema.parse({ logo: 'aGVsbG8=' })).toThrow()
    expect(() => BrandingPatchSchema.parse({ extra: true })).toThrow()
  })
})
