import { describe, expect, it } from 'vitest'
import { BrandingPatchSchema } from '../branding'

describe('BrandingPatchSchema', () => {
  it('accepts only a primary colour update', () => {
    expect(BrandingPatchSchema.parse({ primary_color: '#0055ff' })).toEqual({ primary_color: '#0055ff' })
  })

  it('rejects institution identity fields, including mixed patches', () => {
    for (const identity of [{ name: 'Changed' }, { logo: 'cG5n' }]) {
      expect(BrandingPatchSchema.safeParse(identity).success).toBe(false)
      expect(BrandingPatchSchema.safeParse({ primary_color: '#123456', ...identity }).success).toBe(false)
    }
  })

  it('rejects empty, unknown and malformed colour patches', () => {
    for (const patch of [{}, { unknown: true }, { primary_color: '#abc' }, { primary_color: null }]) {
      expect(BrandingPatchSchema.safeParse(patch).success).toBe(false)
    }
  })
})
