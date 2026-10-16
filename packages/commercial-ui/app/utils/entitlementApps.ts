type FeatureMap = Record<string, boolean | number | null>

const ENABLED = /^([a-z][a-z0-9_]*)\.enabled$/

/** The applications a compiled entitlement opens, read from its `<app>.enabled` keys.
 * `entitlement.modules` is the whole release (every application is installed in every
 * tenant), so it never says which applications a customer has. */
export function entitledFeaturePrefixes(features: FeatureMap | null | undefined): string[] {
  return Object.entries(features ?? {})
    .flatMap(([key, value]) => {
      const match = ENABLED.exec(key)
      return match && value === true ? [match[1]!] : []
    })
    .sort()
}
