export type VendorFeatureValue = boolean | number | null
export type VendorFeatureKind = 'boolean' | 'limit'

/** Nuxt numeric inputs emit numbers; empty inputs emit an empty string. */
export function buildVendorPolicy(
  fields: ReadonlyArray<readonly [string, VendorFeatureKind]>,
  current: Record<string, VendorFeatureValue>,
  edits: Record<string, boolean | number | string>,
): Record<string, VendorFeatureValue> {
  const features = { ...current }
  for (const [key, kind] of fields) {
    const value = edits[key]
    if (kind === 'boolean') {
      features[key] = value === true
      continue
    }
    if (value === '' || (typeof value === 'string' && !value.trim())) {
      features[key] = null
      continue
    }
    const limit = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
    if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('Invalid feature limit')
    features[key] = limit
  }
  return features
}
