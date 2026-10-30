import { describe, expect, it } from 'vitest'
import { BrandingSchema, BrandingPatchSchema } from '../branding'

describe('secondary company brand color', () => {
  it('accepts a secondary-only update without changing the primary', () => {
    expect(BrandingPatchSchema.parse({ secondary_color: '#aabbcc' })).toEqual({ secondary_color: '#aabbcc' })
  })
  it('preserves both exact colors in the response', () => {
    expect(BrandingSchema.parse({ name: 'LiwanOS', logo_url: '/logo', font: 'IBM', primary_color: '#123456', secondary_color: '#abcdef' }).secondary_color).toBe('#abcdef')
  })
  it('rejects malformed secondary and mixed identity updates atomically', () => {
    for (const value of [{ secondary_color: '#abc' }, { secondary_color: '#123456', name: 'Changed' }, {}]) {
      expect(BrandingPatchSchema.safeParse(value).success).toBe(false)
    }
  })

  it('accepts secondary clear in patch payload', () => {
    expect(BrandingPatchSchema.parse({ secondary_color: null })).toEqual({ secondary_color: null })
  })
})
