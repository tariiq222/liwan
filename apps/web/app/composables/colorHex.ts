import { BrandingPatchSchema, type BrandingPatch } from '@nasq/contracts'

export function normalizeHex(value: string): string | null {
  const candidate = value.trim()
  const withHash = candidate.startsWith('#') ? candidate : `#${candidate}`
  return /^#[0-9a-fA-F]{6}$/.test(withHash) ? withHash.toLowerCase() : null
}

export function buildBrandingPatch(input: { primaryColor: string; secondaryColor?: string | null }): BrandingPatch | null {
  const primaryColor = normalizeHex(input.primaryColor)
  if (!primaryColor) return null
  const secondaryColor = input.secondaryColor === undefined
    ? undefined
    : input.secondaryColor === null
      ? null
      : normalizeHex(input.secondaryColor)
  if (secondaryColor === null && input.secondaryColor !== null) return null
  const parsed = BrandingPatchSchema.safeParse({
    primary_color: primaryColor,
    ...(secondaryColor !== undefined ? { secondary_color: secondaryColor } : {}),
  })
  return parsed.success ? parsed.data : null
}
