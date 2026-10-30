import { BrandingPatchSchema, type BrandingPatch } from '@liwan/contracts'

export function normalizeHex(value: string): string | null {
  const candidate = value.trim()
  const withHash = candidate.startsWith('#') ? candidate : `#${candidate}`
  return /^#[0-9a-fA-F]{6}$/.test(withHash) ? withHash.toLowerCase() : null
}

export function buildBrandingPatch(input: { primaryColor: string }): BrandingPatch | null {
  const primaryColor = normalizeHex(input.primaryColor)
  if (!primaryColor) return null
  const parsed = BrandingPatchSchema.safeParse({
    primary_color: primaryColor,
  })
  return parsed.success ? parsed.data : null
}
