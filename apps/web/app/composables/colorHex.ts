import { BrandingPatchSchema, type BrandingPatch } from '@nasq/contracts'

export function normalizeHex(value: string): string | null {
  const candidate = value.trim()
  const withHash = candidate.startsWith('#') ? candidate : `#${candidate}`
  return /^#[0-9a-fA-F]{6}$/.test(withHash) ? withHash.toLowerCase() : null
}

export function buildBrandingPatch(input: {
  name: string
  primaryColor: string
  logo?: string | null
}): BrandingPatch | null {
  const primaryColor = normalizeHex(input.primaryColor)
  if (!primaryColor) return null

  const candidate: Record<string, string> = {
    name: input.name.trim(),
    primary_color: primaryColor,
  }
  if (input.logo) candidate.logo = input.logo
  const parsed = BrandingPatchSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}
